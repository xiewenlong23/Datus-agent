import { useState } from 'react'
import { Check, Copy, FileCode2 } from 'lucide-react'
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter'
import { oneDark } from 'react-syntax-highlighter/dist/esm/styles/prism'

interface CodeCardProps {
  code: string
  codeType?: string
}

/** Collapsible code card with syntax highlighting and copy, mirroring the original chatbot's SQL card. */
export default function CodeCard({ code, codeType = 'sql' }: CodeCardProps) {
  const [copied, setCopied] = useState(false)

  const handleCopy = () => {
    navigator.clipboard.writeText(code).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    }).catch(() => {})
  }

  return (
    <div className="code-card">
      <div className="code-card-header">
        <FileCode2 size={13} />
        <span className="code-card-lang">{codeType.toUpperCase()}</span>
        <button className="code-card-copy" onClick={handleCopy} title="复制">
          {copied ? <Check size={13} /> : <Copy size={13} />}
        </button>
      </div>
      <SyntaxHighlighter
        language={codeType === 'sql' ? 'sql' : codeType}
        style={oneDark}
        customStyle={{ margin: 0, background: 'transparent', fontSize: 12.5 }}
        codeTagProps={{ style: { fontFamily: 'var(--font-mono)' } }}
      >
        {code}
      </SyntaxHighlighter>
    </div>
  )
}
