import type { ChatMessage } from '../stores/chatStore'

interface MessageBubbleProps {
  message: ChatMessage
}

export default function MessageBubble({ message }: MessageBubbleProps) {
  const isUser = message.role === 'user'

  return (
    <div className={`message ${isUser ? 'user' : 'assistant'}`}>
      {!isUser && (
        <div className="message-assistant-avatar">D</div>
      )}
      <div>
        {message.content.map((block, i) => {
          if (block.type === 'markdown') {
            const content = (block.payload.content as string) || ''
            return (
              <div
                key={i}
                className={`message-bubble ${isUser ? '' : 'markdown'}`}
                dangerouslySetInnerHTML={{
                  __html: isUser
                    ? escapeHtml(content).replace(/\n/g, '<br>')
                    : renderMarkdownSimple(content),
                }}
              />
            )
          }
          if (block.type === 'tool_call') {
            return (
              <div key={i} className="tool-card">
                {(block.payload.name as string) || '工具调用'}...
              </div>
            )
          }
          return null
        })}
        <div className="message-timestamp">
          {new Date(message.timestamp).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}
        </div>
      </div>
    </div>
  )
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function renderMarkdownSimple(text: string): string {
  // Simple markdown rendering for P1 (P3 will use react-markdown)
  let html = escapeHtml(text)

  // Code blocks
  html = html.replace(/```(\w*)\n([\s\S]*?)```/g, (_, lang, code) => {
    return `<pre><code class="language-${lang || ''}">${escapeHtml(code)}</code></pre>`
  })

  // Inline code
  html = html.replace(/`([^`]+)`/g, '<code>$1</code>')

  // Bold
  html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')

  // Italic
  html = html.replace(/\*(.+?)\*/g, '<em>$1</em>')

  // Headings
  html = html.replace(/^### (.+)$/gm, '<h3>$1</h3>')
  html = html.replace(/^## (.+)$/gm, '<h2>$1</h2>')
  html = html.replace(/^# (.+)$/gm, '<h1>$1</h1>')

  // Tables (basic)
  html = html.replace(/^\|(.+)\|$/gm, (line) => {
    const cells = line.split('|').filter(c => c.trim())
    if (cells.every(c => /^[\s:-]+$/.test(c))) return '<hr>'
    return `<tr>${cells.map(c => `<td>${c.trim()}</td>`).join('')}</tr>`
  })

  // Ordered/unordered lists
  html = html.replace(/^- (.+)$/gm, '<li>$1</li>')
  html = html.replace(/^\d+\. (.+)$/gm, '<li>$1</li>')

  // Line breaks
  html = html.replace(/\n\n/g, '</p><p>')
  html = html.replace(/\n/g, '<br>')

  // Wrap table rows
  html = html.replace(/(<tr>.*?<\/tr>)/g, '<table>$1</table>')

  // Wrap consecutive lists
  html = html.replace(/(<li>.*?)(?:(?=<\/p>)|$)/gs, '<ul>$1</ul>')

  return `<p>${html}</p>`
}