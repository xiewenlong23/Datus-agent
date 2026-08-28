import { useState, useCallback, useRef, useEffect, KeyboardEvent } from 'react'
import { useChatStore } from '../stores/chatStore'
import { sendChat, stopSessionStream } from '../services/chat'
import { ArrowUp, Square, Terminal } from 'lucide-react'
import ContextBar from './ContextBar'

interface SkillItem {
  name: string
  description: string
  tags: string[]
  userInvocable: boolean
}

function fetchSkills(): Promise<SkillItem[]> {
  return fetch('/api/v1/skills/list')
    .then(r => r.json())
    .then(d => (d.data?.skills || []).filter((s: any) => s.frontmatter?.user_invocable === true))
    .catch(() => [])
}

export default function InputBox() {
  const [text, setText] = useState('')
  const [showCmdMenu, setShowCmdMenu] = useState(false)
  const [cmdQuery, setCmdQuery] = useState('')
  const [cmdIdx, setCmdIdx] = useState(0)
  const [skills, setSkills] = useState<SkillItem[]>([])
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const cmdMenuRef = useRef<HTMLDivElement>(null)
  const {
    isStreaming, setSessionStreaming, addMessage, sessionId,
  } = useChatStore()

  // Fetch skills for the slash-command menu
  useEffect(() => {
    fetchSkills().then(setSkills)
  }, [])

  // Close command menu on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (cmdMenuRef.current && !cmdMenuRef.current.contains(e.target as Node)) {
        setShowCmdMenu(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  useEffect(() => {
    textareaRef.current?.focus()
  }, [])

  const canSend = text.trim().length > 0 && !isStreaming

  const handleSend = useCallback(() => {
    const content = text.trim()
    if (!content || isStreaming) return

    setText('')

    const {
      sessionId, currentTaskType, outputOptions,
      selectedAgent: agent, selectedDatasource: ds, selectedModel: model, planMode,
    } = useChatStore.getState()
    const key = sessionId ?? ''

    // The user bubble lands in this session's slice; the send subscription
    // (module-scoped, survives this component's remount) routes the backend
    // events into the same slice — even after the user switches away.
    addMessage({
      id: `user-local-${Date.now()}`,
      role: 'user',
      content: [{ type: 'markdown', payload: { content } }],
      depth: 0,
      timestamp: new Date().toISOString(),
    })
    setSessionStreaming(key, true)

    sendChat({
      message: content,
      session_id: sessionId,
      subagent_id: agent,
      database: ds,
      model,
      plan_mode: planMode,
      task_type: currentTaskType,
      output_options: Object.keys(outputOptions).length > 0 ? outputOptions : null,
    })
  }, [text, isStreaming, addMessage, setSessionStreaming, sessionId])

  const handleStop = useCallback(() => {
    // Tell the backend to halt AND sever this session's subscription.
    stopSessionStream(sessionId ?? '')
  }, [sessionId])

  const filteredSkills = showCmdMenu
    ? skills.filter(s => s.name.toLowerCase().includes(cmdQuery.toLowerCase()))
    : []

  const handleTextChange = (value: string) => {
    setText(value)
    const cursorPos = textareaRef.current?.selectionStart ?? value.length
    const textBefore = value.slice(0, cursorPos)
    const lastSlash = textBefore.lastIndexOf('/')
    if (lastSlash >= 0 && !textBefore.slice(lastSlash).includes(' ')) {
      setShowCmdMenu(true)
      setCmdQuery(textBefore.slice(lastSlash + 1))
      setCmdIdx(0)
    } else {
      setShowCmdMenu(false)
    }
  }

  const insertCommand = (skillName: string) => {
    const cursorPos = textareaRef.current?.selectionStart ?? text.length
    const textBefore = text.slice(0, cursorPos)
    const lastSlash = textBefore.lastIndexOf('/')
    const textAfter = text.slice(cursorPos)
    setText(textBefore.slice(0, lastSlash) + `/${skillName} ` + textAfter)
    setShowCmdMenu(false)
    textareaRef.current?.focus()
  }

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (showCmdMenu && filteredSkills.length > 0) {
      if (e.key === 'ArrowDown') {
        e.preventDefault()
        setCmdIdx(i => Math.min(i + 1, filteredSkills.length - 1))
        return
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault()
        setCmdIdx(i => Math.max(i - 1, 0))
        return
      }
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault()
        insertCommand(filteredSkills[cmdIdx].name)
        return
      }
      if (e.key === 'Escape') {
        setShowCmdMenu(false)
        return
      }
    }
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  const adjustHeight = useCallback(() => {
    const el = textareaRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = Math.min(el.scrollHeight, 200) + 'px'
  }, [])

  return (
    <div className="chat-input-container">
      {showCmdMenu && filteredSkills.length > 0 && (
        <div className="cmd-menu" ref={cmdMenuRef}>
          <div className="cmd-menu-header">技能命令</div>
          {filteredSkills.map((skill, i) => (
            <button
              key={skill.name}
              className={`cmd-menu-item${i === cmdIdx ? ' active' : ''}`}
              onMouseDown={(e) => { e.preventDefault(); insertCommand(skill.name) }}
              onMouseEnter={() => setCmdIdx(i)}
            >
              <Terminal size={13} />
              <span style={{ flex: 1, minWidth: 0 }}>{skill.name}</span>
              <span className="cmd-menu-desc">{skill.description.slice(0, 40)}</span>
            </button>
          ))}
        </div>
      )}

      <div className="chat-input-top">
        <textarea
          ref={textareaRef}
          className="chat-textarea"
          rows={1}
          placeholder="输入你的问题，/ 调用技能…"
          value={text}
          onChange={e => { handleTextChange(e.target.value); adjustHeight() }}
          onKeyDown={handleKeyDown}
          disabled={isStreaming}
        />
      </div>
      <div className="chat-input-controls">
        <ContextBar />
        <button
          className="send-btn"
          disabled={!canSend && !isStreaming}
          onClick={isStreaming ? handleStop : handleSend}
          aria-label={isStreaming ? '停止' : '发送'}
        >
          {isStreaming ? <Square size={14} fill="currentColor" /> : <ArrowUp size={16} />}
        </button>
      </div>
    </div>
  )
}
