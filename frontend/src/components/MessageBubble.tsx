import { useMemo, useState } from 'react'
import { Copy, Check } from 'lucide-react'
import type { ChatMessage } from '../stores/chatStore'
import { useChatStore } from '../stores/chatStore'
import type { IMessageContent } from '../types/chat'
import AssistantSteps, { ToolCallRow, findToolResult } from './chat/AssistantSteps'
import CodeCard from './chat/CodeCard'
import CsvTable from './chat/CsvTable'
import MarkdownRenderer from './MarkdownRenderer'
import UserInteractionCard, { AskUserHistoryCard } from './chat/UserInteractionCard'

interface MessageBubbleProps {
  message: ChatMessage
}

/** Tools that drive dedicated UI (todo panel / ask-user dialog) — hidden from the step list. */
const HIDDEN_TOOLS = new Set(['todo_write', 'todo_delete'])

/**
 * Mirrors the original chatbot: call-tool-result blocks are attached to their
 * call (or filtered out), never rendered standalone. Whitespace-only text
 * blocks (e.g. thinking "\n\n") are dropped as well.
 */
function visibleBlocks(content: IMessageContent[]): IMessageContent[] {
  return content.filter(b => {
    if (b.type === 'call-tool-result') return false
    if (b.type === 'call-tool' && HIDDEN_TOOLS.has(b.payload?.toolName)) return false
    if (
      (b.type === 'thinking' || b.type === 'markdown' || b.type === 'error') &&
      typeof b.payload?.content === 'string' &&
      !b.payload.content.trim()
    ) return false
    return true
  })
}

/**
 * Original KZe: the trailing run of markdown/code blocks is the final answer.
 * If the last block is some other type, that last block alone still renders
 * below the steps card. Returns -1 when every block is answer-type.
 */
function findAnswerStart(blocks: IMessageContent[]): number {
  if (!blocks.length) return -1
  const last = blocks.length - 1
  for (let i = last; i >= 0; i--) {
    const t = blocks[i].type
    if (t !== 'markdown' && t !== 'code') return i === last ? last : i + 1
  }
  return -1
}

/** Original JZe: the collapsible steps card only wraps multi-block messages
 * that contain a tool call or user interaction; everything else renders plain. */
function useStepsCard(message: ChatMessage): boolean {
  const len = message.content?.length ?? 0
  if (len <= 1) return false
  return message.content
    .filter(b => b.type !== 'call-tool-result')
    .some(b => b.type === 'call-tool' || b.type === 'user-interaction')
}

function flatText(blocks: IMessageContent[]): string {
  return blocks
    .filter(b => ['markdown', 'thinking', 'code', 'error'].includes(b.type))
    .map(b => b.payload?.content || '')
    .filter(Boolean)
    .join('\n')
}

function AnswerBlock({ block, streaming }: { block: IMessageContent; streaming: boolean }) {
  switch (block.type) {
    case 'markdown':
    case 'thinking':
      return <MarkdownRenderer content={block.payload?.content || ''} streaming={streaming} />
    case 'code':
      return <CodeCard code={block.payload?.content || ''} codeType={block.payload?.codeType || block.payload?.code_type || 'sql'} />
    case 'csv':
      return <CsvTable csv={block.payload?.content || ''} />
    case 'error':
      return <div className="answer-error">{block.payload?.content || 'Unknown error'}</div>
    case 'artifact': {
      const p = block.payload || {}
      return (
        <div className="artifact-card">
          <div className="artifact-card-title">{p.name || p.slug}</div>
          {p.description && <div className="artifact-card-desc">{p.description}</div>}
          <div className="artifact-card-kind">{p.kind === 'dashboard' ? '仪表盘' : '报告'}</div>
        </div>
      )
    }
    case 'subagent-complete':
      return <MarkdownRenderer content={block.payload?.content || block.payload?.summary || ''} />
    default:
      return null
  }
}

/** True when any viewport message currently carries an open interaction card. */
function useHasInteractionCard(): boolean {
  const messages = useChatStore(s => s.messages)
  return messages.some(m => m.content.some(b => b.type === 'user-interaction'))
}

export default function MessageBubble({ message }: MessageBubbleProps) {
  const isUser = message.role === 'user'
  const { isStreaming, messages, sessionId } = useChatStore()
  const hasInteractionCard = useHasInteractionCard()
  const [copied, setCopied] = useState(false)

  const isLastAssistant = !isUser && messages.length > 0 && messages[messages.length - 1].id === message.id
  const streamingThis = isLastAssistant && isStreaming

  const { cardSteps, answer, plain } = useMemo(() => {
    if (isUser) return { cardSteps: [], answer: [], plain: [] as IMessageContent[] }
    if (!useStepsCard(message)) {
      return { cardSteps: [], answer: [], plain: visibleBlocks(message.content) }
    }
    const blocks = visibleBlocks(message.content)
    const s = findAnswerStart(blocks)
    return s > 0
      ? { cardSteps: blocks.slice(0, s), answer: blocks.slice(s), plain: [] as IMessageContent[] }
      : { cardSteps: blocks, answer: [] as IMessageContent[], plain: [] as IMessageContent[] }
  }, [isUser, message])

  const copyText = useMemo(
    () => flatText(isUser ? message.content : visibleBlocks(message.content)),
    [isUser, message],
  )

  const handleCopy = () => {
    navigator.clipboard.writeText(copyText).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    }).catch(() => {})
  }

  if (isUser) {
    return (
      <div className="message user">
        <div className="message-body">
          {message.atContext && (
            <div className="at-context-chips">
              {[
                ...message.atContext.table_paths,
                ...message.atContext.metric_paths,
                ...message.atContext.sql_paths,
                ...message.atContext.knowledge_paths,
              ].map(p => <span key={p} className="at-context-chip">@{p}</span>)}
            </div>
          )}
          <div className="message-content bubble">
            <div className="user-text">{flatText(message.content)}</div>
          </div>
        </div>
      </div>
    )
  }

  // Messages whose only content is an attached call-tool-result render nothing.
  if (cardSteps.length === 0 && answer.length === 0 && plain.length === 0 && !streamingThis) {
    return null
  }

  const isSubagent = (message.depth ?? 0) > 0

  const renderBlock = (block: IMessageContent, i: number, arr: IMessageContent[]): React.ReactNode => {
    if (block.type === 'user-interaction') {
      return (
        <UserInteractionCard
          key={`uic-${block.payload?.interactionKey || i}`}
          block={block}
          sessionId={sessionId}
          streaming={streamingThis}
        />
      )
    }
    if (block.type === 'call-tool' && block.payload?.toolName === 'ask_user') {
      // Completed (history carries the attached result): show the Q/A card.
      if (findToolResult(block, message.content) || block.payload?.resultPayload) {
        return <AskUserHistoryCard key={`askhist-${i}`} call={block} />
      }
      // Live pending: the user-interaction card already shows the question —
      // render nothing unless that card is missing (defensive fallback).
      if (!hasInteractionCard) {
        return <ToolCallRow key={`asklive-${i}`} call={block} result={undefined} streaming={streamingThis} />
      }
      return null
    }
    if (block.type === 'call-tool') {
      return (
        <ToolCallRow
          key={i}
          call={block}
          result={findToolResult(block, message.content)}
          streaming={streamingThis}
        />
      )
    }
    return (
      <AnswerBlock
        key={i}
        block={block}
        streaming={streamingThis && i === arr.length - 1 && (block.type === 'markdown' || block.type === 'thinking')}
      />
    )
  }

  return (
    <div className={`message assistant${isSubagent ? ' subagent' : ''}`}>
      <div className="message-body">
        {isSubagent && <div className="subagent-tag">子代理</div>}

        {cardSteps.length > 0 && <AssistantSteps steps={cardSteps} streaming={streamingThis} />}

        <div className="message-content">
          {cardSteps.length === 0 && answer.length === 0 && plain.length === 0 && streamingThis && (
            <div className="assistant-thinking"><span className="dot" />思考中<span className="dot" /><span className="dot" /></div>
          )}
          {answer.map((block, i) => renderBlock(block, i, answer))}
          {plain.map((block, i) => renderBlock(block, i, plain))}
        </div>

        {!streamingThis && copyText && (
          <div className="message-actions">
            <button className="message-action-btn" onClick={handleCopy} title="复制">
              {copied ? <Check size={13} /> : <Copy size={13} />} {copied ? '已复制' : '复制'}
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
