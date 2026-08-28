import { useMemo, useState } from 'react'
import { Check, CircleHelp, Loader2, Send, UserRound } from 'lucide-react'
import type { IMessageContent, UserInteractionPayload, UserInteractionRequest } from '../../types/chat'
import { submitUserInteraction } from '../../services/chat'
import MarkdownRenderer from '../MarkdownRenderer'

/**
 * Interactive card for a pending ``user-interaction`` block (the agent's
 * ``ask_user`` / batch clarification). Renders the questions with option
 * buttons + free-text input; submitting answers the broker future and
 * unblocks the (otherwise stuck) run.
 *
 * The answered state comes from ``payload.answered`` — stamped by the
 * backend's UPDATE event (survives refresh/replay) or set locally right
 * after a successful submit.
 */
export default function UserInteractionCard({ block, sessionId, streaming }: {
  block: IMessageContent
  sessionId: string | null
  streaming: boolean
}) {
  const payload = (block.payload || {}) as UserInteractionPayload
  const requests = Array.isArray(payload.requests) ? payload.requests : []
  const serverAnswered = Array.isArray(payload.answered) && payload.answered.length > 0
    ? payload.answered
    : null

  const [selected, setSelected] = useState<Record<number, string[]>>({})
  const [texts, setTexts] = useState<string[]>([])
  const [localAnswered, setLocalAnswered] = useState<string[][] | null>(null)
  const [sending, setSending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const answered = localAnswered || serverAnswered
  const closed = !streaming && !answered

  const toggle = (qi: number, key: string, multi: boolean) => {
    setSelected(prev => {
      const cur = prev[qi] || []
      const next = multi
        ? cur.includes(key) ? cur.filter(k => k !== key) : [...cur, key]
        : [key]
      return { ...prev, [qi]: next }
    })
    setError(null)
  }

  const questionAnswerable = (qi: number): boolean => {
    const q = requests[qi]
    if ((texts[qi] || '').trim() !== '') return true
    const sel = selected[qi] || []
    return q.multiSelect ? sel.length > 0 : sel.length === 1
  }

  const canSubmit = streaming && !sending && requests.length > 0 && requests.every((_, qi) => questionAnswerable(qi))

  const handleToggle = (qi: number, key: string, multi: boolean) => {
    if (answered || closed || sending) return
    toggle(qi, key, multi)
  }

  const handleSubmit = async () => {
    if (!sessionId || !canSubmit) return
    setSending(true)
    setError(null)
    const input = requests.map((_q, qi) => {
      const text = (texts[qi] || '').trim()
      if (text) return [text]
      return selected[qi] || []
    })
    const res = await submitUserInteraction(sessionId, payload.interactionKey, input)
    setSending(false)
    if (res.ok) {
      setLocalAnswered(input)
    } else {
      setError(res.error || '提交失败,请重试')
    }
  }

  if (requests.length === 0) return null

  return (
    <div className={`uic-card${answered ? ' answered' : ''}${closed ? ' closed' : ''}`}>
      <div className="uic-header">
        {answered
          ? <Check size={14} className="uic-icon-done" />
          : <CircleHelp size={14} className={streaming ? 'spin-slow' : ''} />}
        <span className="uic-title">{answered ? '已回答' : closed ? '会话已结束' : '请回答以下问题'}</span>
      </div>

      {requests.map((q, qi) => {
        const sel = selected[qi] || []
        return (
          <div key={qi} className="uic-question">
            {requests.length > 1 && <div className="uic-q-label">{q.title}</div>}
            <div className="uic-q-text"><MarkdownRenderer content={q.content || ''} /></div>

            {answered ? (
              <div className="uic-answered-value">
                {(answered[qi] || []).map((v, vi) => (
                  <span key={vi} className="uic-answer-chip">{resolveAnswer(q, v)}</span>
                ))}
              </div>
            ) : (
              <>
                {q.options && q.options.length > 0 && (
                  <div className="uic-options">
                    {q.options.map(opt => {
                      const on = sel.includes(opt.key)
                      return (
                        <button
                          key={opt.key}
                          type="button"
                          className={`uic-option${on ? ' on' : ''}`}
                          disabled={closed || sending}
                          onClick={() => handleToggle(qi, opt.key, !!q.multiSelect)}
                        >
                          <span className={`uic-option-mark${q.multiSelect ? ' box' : ''}${on ? ' on' : ''}`} />
                          {opt.title}
                        </button>
                      )
                    })}
                  </div>
                )}
                {q.allowFreeText !== false && (
                  <input
                    type="text"
                    className="uic-input"
                    placeholder={q.options?.length ? '或输入自定义答案…' : '请输入答案…'}
                    value={texts[qi] || ''}
                    disabled={closed || sending}
                    onChange={e => {
                      setTexts(prev => {
                        const next = [...prev]
                        next[qi] = e.target.value
                        return next
                      })
                      setError(null)
                    }}
                    onKeyDown={e => { if (e.key === 'Enter' && canSubmit) void handleSubmit() }}
                  />
                )}
              </>
            )}
          </div>
        )
      })}

      {!answered && (
        <div className="uic-footer">
          {error && <span className="uic-error">{error}</span>}
          {closed ? (
            <span className="uic-muted">该问题已无法回答</span>
          ) : (
            <button type="button" className="uic-submit" disabled={!canSubmit} onClick={() => void handleSubmit()}>
              {sending ? <Loader2 size={13} className="spin" /> : <Send size={13} />}
              {sending ? '提交中…' : '提交回答'}
            </button>
          )}
        </div>
      )}
    </div>
  )
}

/** Map an answer value back to its display text (choice key → option title). */
function resolveAnswer(q: UserInteractionRequest, value: string): string {
  if (value === '') return '(空)'
  const opt = q.options?.find(o => o.key === value)
  return opt ? opt.title : value
}

/**
 * Read-only card for a COMPLETED ``ask_user`` tool call rendered from
 * history (the live card above only exists while the run is in flight).
 * Pairs ``toolParams.questions`` with the parsed ``resultPayload`` answers.
 */
export function AskUserHistoryCard({ call }: { call: IMessageContent }) {
  const questions: any[] = useMemo(() => {
    const qs = call.payload?.toolParams?.questions
    return Array.isArray(qs) ? qs : []
  }, [call])

  const answers: { question: string; answer: string | string[] }[] = useMemo(() => {
    const raw = call.payload?.resultPayload?.result
    if (typeof raw !== 'string') return []
    try {
      const parsed = JSON.parse(raw)
      return Array.isArray(parsed) ? parsed : []
    } catch {
      return []
    }
  }, [call])

  const cancelled = Boolean(call.payload?.resultPayload?.error)
  if (questions.length === 0) return null

  return (
    <div className="uic-card answered static">
      <div className="uic-header">
        <UserRound size={14} />
        <span className="uic-title">{cancelled ? '用户提问(已取消)' : '曾向用户提问'}</span>
      </div>
      {questions.map((q, i) => {
        const a = answers[i] || answers.find(x => x.question === q.question)
        return (
          <div key={i} className="uic-question">
            {questions.length > 1 && <div className="uic-q-label">{q.title}</div>}
            <div className="uic-q-text">{q.question}</div>
            {a && (
              <div className="uic-answered-value">
                <span className="uic-answer-chip">
                  {Array.isArray(a.answer) ? a.answer.join('、') : String(a.answer)}
                </span>
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}
