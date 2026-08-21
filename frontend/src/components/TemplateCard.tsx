import type { QuickAction } from '../stores/chatStore'
import { useChatStore } from '../stores/chatStore'

interface TemplateCardProps {
  action: QuickAction
}

export default function TemplateCard({ action }: TemplateCardProps) {
  const { isStreaming } = useChatStore()

  const handleClick = () => {
    if (isStreaming) return
    // Dispatch custom event for InputBox to pick up
    const event = new CustomEvent('fill-prompt', { detail: { prompt: action.prompt } })
    window.dispatchEvent(event)
  }

  return (
    <div className="quick-card" onClick={handleClick}>
      <div className="quick-card-title">{action.title}</div>
      {action.tags.length > 0 && (
        <div className="quick-card-tags">
          {action.tags.map((tag, i) => (
            <span key={i} className="quick-tag">{tag}</span>
          ))}
        </div>
      )}
      <div className="quick-card-desc">{action.description}</div>
    </div>
  )
}