import { useMemo, useState } from 'react'
import {
  ChevronDown, ChevronRight, Lightbulb, Wrench, CheckCircle2, XCircle,
  Loader2, FileCode2, MessageSquareText,
} from 'lucide-react'
import { useChatStore } from '../../stores/chatStore'
import type { IMessageContent } from '../../types/chat'
import MarkdownRenderer from '../MarkdownRenderer'
import CodeCard from './CodeCard'
import CsvTable from './CsvTable'
import UserInteractionCard, { AskUserHistoryCard } from './UserInteractionCard'

interface AssistantStepsProps {
  steps: IMessageContent[]
  streaming: boolean
}

interface ToolPair {
  call: IMessageContent
  result?: IMessageContent
}

/** Tools that drive dedicated UI (todo panel) — hidden from the step list.
 * ``ask_user`` is NOT hidden: it renders as a Q/A card (live or history). */
const HIDDEN_TOOLS = new Set(['todo_write', 'todo_update'])

function formatDuration(seconds: unknown): string {
  const n = typeof seconds === 'number' ? seconds : parseFloat(String(seconds))
  if (!Number.isFinite(n) || n <= 0) return ''
  return n < 1 ? `${Math.round(n * 1000)}ms` : `${n.toFixed(1)}s`
}

/** Find the result block for a call: same-message pairing, or the
 * `resultPayload` attached during history load (attachCallToolResult). */
export function findToolResult(call: IMessageContent, pool: IMessageContent[]): IMessageContent | undefined {
  const id = String(call.payload?.callToolId ?? '')
  const inline = pool.find(
    b => b.type === 'call-tool-result' && String(b.payload?.callToolId ?? '') === id,
  )
  if (inline) return inline
  const attached = call.payload?.resultPayload
  return attached ? { type: 'call-tool-result', payload: attached } : undefined
}

/** Friendly tool labels mirroring the original chatbot (hardcoded EN labels
 * with a meaningful subtitle picked from the tool params). */
const TOOL_LABELS: Record<string, { label: string; sub: (p: any) => string | undefined }> = {
  read_file: { label: 'Read', sub: p => p?.path },
  write_file: { label: 'Write', sub: p => p?.path },
  edit_file: { label: 'Edit', sub: p => p?.path },
  glob: { label: 'Glob', sub: p => p?.pattern },
  grep: { label: 'Grep', sub: p => p?.pattern },
  task: { label: 'Subagent', sub: p => p?.type },
  read_query: { label: 'Read Query', sub: p => p?.database },
  load_skill: { label: 'Load Skill', sub: p => p?.skill_name },
  skill_execute_command: { label: 'Execute Skill', sub: p => p?.skill_name },
}

/** Render a describe_table column list as a table, like the original. */
function ColumnsTable({ columns }: { columns: any[] }) {
  return (
    <div className="csv-table-wrapper">
      <table className="csv-table">
        <thead>
          <tr><th>name</th><th>type</th><th>comment</th></tr>
        </thead>
        <tbody>
          {columns.map((c, i) => (
            <tr key={i}><td>{c.name}</td><td>{c.type}</td><td>{c.comment}</td></tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

/** read_query expanded content: the SQL plus the compressed CSV result. */
function ReadQueryResult({ params, result }: { params: any; result: any }) {
  return (
    <>
      {params?.sql && (
        <>
          <div className="step-section-label">SQL</div>
          <CodeCard code={params.sql} codeType="sql" />
        </>
      )}
      {result?.compressed_data && (
        <>
          <div className="step-section-label">
            结果{result.original_rows != null ? `（${result.original_rows} 行）` : ''}
          </div>
          <CsvTable csv={result.compressed_data} />
        </>
      )}
    </>
  )
}

export function ToolCallRow({ call, result, streaming }: {
  call: IMessageContent
  result?: IMessageContent
  streaming: boolean
}) {
  const name: string = call.payload?.toolName || 'tool'
  const params = call.payload?.toolParams
  const meta = TOOL_LABELS[name]
  const label = meta?.label || 'Call Tool'
  const labelSub = meta ? meta.sub(params) : name
  const failed = Boolean(result?.payload?.error)
  const done = Boolean(result)
  const duration = formatDuration(result?.payload?.duration)
  const shortDesc = result?.payload?.shortDesc || ''
  const resultPayload = result?.payload?.result
  const inner = resultPayload?.result ?? resultPayload
  const columns = inner?.columns
  const isReadQuery = name === 'read_query' && inner?.compressed_data

  return (
    <StepRow
      icon={failed
        ? <XCircle size={14} className="step-icon-error" />
        : done
          ? <CheckCircle2 size={14} className="step-icon-done" />
          : <Wrench size={14} className={streaming ? 'spin-slow' : ''} />}
      title={<>{label} <code>{labelSub}</code></>}
      sub={[duration, shortDesc].filter(Boolean).join(' · ')}
    >
      {isReadQuery ? (
        <ReadQueryResult params={params} result={inner} />
      ) : Array.isArray(columns) && columns.length > 0 ? (
        <ColumnsTable columns={columns} />
      ) : (params && Object.keys(params).length > 0) || resultPayload ? (
        <>
          {params && Object.keys(params).length > 0 && (
            <>
              <div className="step-section-label">参数</div>
              <pre className="step-pre">{JSON.stringify(params, null, 2)}</pre>
            </>
          )}
          {result && (
            <>
              <div className="step-section-label">结果</div>
              <pre className="step-pre">
                {result.payload?.error
                  ? String(result.payload.error)
                  : typeof resultPayload === 'string'
                    ? resultPayload
                    : JSON.stringify(inner, null, 2)}
              </pre>
            </>
          )}
        </>
      ) : null}
    </StepRow>
  )
}

function StepRow({ icon, title, sub, children, defaultOpen = false }: {
  icon: React.ReactNode
  title: React.ReactNode
  sub?: string
  children?: React.ReactNode
  defaultOpen?: boolean
}) {
  const [open, setOpen] = useState(defaultOpen)
  const expandable = Boolean(children)
  return (
    <div className="step-row">
      <button
        className={`step-row-header${expandable ? '' : ' static'}`}
        onClick={() => expandable && setOpen(!open)}
      >
        <span className="step-row-icon">{icon}</span>
        <span className="step-row-title">{title}</span>
        {sub && <span className="step-row-sub">{sub}</span>}
        {expandable && (open ? <ChevronDown size={13} /> : <ChevronRight size={13} />)}
      </button>
      {expandable && open && <div className="step-row-content">{children}</div>}
    </div>
  )
}

/**
 * Collapsible "thinking process" card: pairs call-tool with call-tool-result
 * by callToolId and renders every pre-answer block as a timeline step.
 */
export default function AssistantSteps({ steps, streaming }: AssistantStepsProps) {
  const [expanded, setExpanded] = useState<boolean | null>(null)
  const isExpanded = expanded ?? streaming
  const sessionId = useChatStore(s => s.sessionId)

  const items = useMemo(() => {
    const out: Array<IMessageContent | ToolPair> = []
    for (const b of steps) {
      if (b.type === 'call-tool-result') continue
      if (b.type === 'call-tool') {
        out.push({ call: b, result: findToolResult(b, steps) })
      } else {
        out.push(b)
      }
    }
    return out.filter(it => {
      if ('call' in it) return !HIDDEN_TOOLS.has(it.call.payload?.toolName)
      return true
    })
  }, [steps])

  if (items.length === 0) return null

  return (
    <div className={`steps-card${streaming ? ' streaming' : ''}`}>
      <button className="steps-card-header" onClick={() => setExpanded(!isExpanded)}>
        {streaming ? <Loader2 size={14} className="spin" /> : <CheckCircle2 size={14} />}
        <span className="steps-card-title">{streaming ? '思考中' : '思考过程'}</span>
        <span className="steps-card-count">{items.length} 步</span>
        {isExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
      </button>

      {isExpanded && (
        <div className="steps-card-body">
          {items.map((item, idx) => {
            if ('call' in item) {
              if (item.call.payload?.toolName === 'ask_user') {
                // Answered (history result attached) → Q/A card; live pending →
                // the user-interaction card elsewhere carries the question.
                return item.result || item.call.payload?.resultPayload
                  ? <AskUserHistoryCard key={`askhist-${idx}`} call={item.call} />
                  : null
              }
              return (
                <ToolCallRow
                  key={`tool-${idx}`}
                  call={item.call}
                  result={item.result}
                  streaming={streaming}
                />
              )
            }

            const block = item as IMessageContent
            switch (block.type) {
              case 'user-interaction':
                return (
                  <UserInteractionCard
                    key={`uic-${idx}`}
                    block={block}
                    sessionId={sessionId}
                    streaming={streaming}
                  />
                )
              case 'thinking':
                return (
                  <StepRow key={`thinking-${idx}`} icon={<Lightbulb size={14} />} title="思考">
                    <MarkdownRenderer content={block.payload?.content || ''} />
                  </StepRow>
                )
              case 'code':
                return (
                  <StepRow key={`code-${idx}`} icon={<FileCode2 size={14} />} title="生成 SQL" defaultOpen>
                    <CodeCard code={block.payload?.content || ''} codeType={block.payload?.codeType || block.payload?.code_type || 'sql'} />
                  </StepRow>
                )
              case 'error':
                return (
                  <StepRow key={`error-${idx}`} icon={<XCircle size={14} className="step-icon-error" />} title="错误" defaultOpen>
                    <pre className="step-pre error">{block.payload?.content || ''}</pre>
                  </StepRow>
                )
              case 'markdown':
              case 'subagent-complete':
                return (
                  <StepRow key={`md-${idx}`} icon={<MessageSquareText size={14} />} title="中间结果">
                    <MarkdownRenderer content={block.payload?.content || block.payload?.summary || ''} />
                  </StepRow>
                )
              default:
                return null
            }
          })}
        </div>
      )}
    </div>
  )
}
