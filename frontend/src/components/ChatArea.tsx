import { useEffect, useRef } from 'react'
import type { TaskTemplate } from '../stores/chatStore'
import { useChatStore } from '../stores/chatStore'
import MessageBubble from './MessageBubble'
import InputBox from './InputBox'
import OutputOptions from './OutputOptions'
import TemplateCard from './TemplateCard'
import FileUpload from './FileUpload'

interface ChatAreaProps {
  template: TaskTemplate | undefined
}

export default function ChatArea({ template }: ChatAreaProps) {
  const { messages } = useChatStore()
  const messagesEndRef = useRef<HTMLDivElement>(null)

  const hasMessages = messages.length > 0

  useEffect(() => {
    if (messagesEndRef.current) {
      messagesEndRef.current.scrollIntoView({ behavior: 'smooth' })
    }
  }, [messages])

  if (!template) {
    return (
      <div className="chat-area initial">
        <div className="chat-welcome">
          <h1>选择任务类型开始</h1>
          <p className="chat-welcome-subtitle">从左侧面板选择一个任务场景</p>
        </div>
      </div>
    )
  }

  if (!hasMessages) {
    return (
      <div className="chat-area initial">
        <div className="chat-welcome">
          <h1>{template.heading}</h1>
          <p className="chat-welcome-subtitle">{template.subtitle}</p>

          {template.fileUpload && <FileUpload />}

          <InputBox template={template} />

          {template.outputOptions.length > 0 && (
            <OutputOptions groups={template.outputOptions} />
          )}

          {template.quickActions.length > 0 && (
            <div className="quick-grid">
              {template.quickActions.map((action, i) => (
                <TemplateCard key={i} action={action} />
              ))}
            </div>
          )}
        </div>
      </div>
    )
  }

  return (
    <div className="chat-area">
      <div className="messages-container">
        {messages.map((msg) => (
          <MessageBubble key={msg.id} message={msg} />
        ))}
        <div ref={messagesEndRef} />
      </div>

      <div style={{ padding: '12px 24px', borderTop: '1px solid var(--border)', background: 'var(--panel-bg)' }}>
        <InputBox template={template} />
      </div>
    </div>
  )
}