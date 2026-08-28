import type { SSEEventName, StreamChatRequest } from '../types/chat'
import { useChatStore } from '../stores/chatStore'

/**
 * Per-session SSE subscription manager.
 *
 * The web backend runs each turn as a background task that buffers its SSE
 * events in memory and survives client disconnects. Instead of one global
 * "active viewer" connection, we keep at most ONE live subscription per
 * session (a task's event buffer has a single shared cursor, so two consumers
 * on the same task would starve each other — different sessions are different
 * tasks and can be consumed concurrently).
 *
 * Subscriptions are module-scoped so they survive React view transitions:
 * switching away from a running session keeps its stream alive in the
 * background (events keep landing in that session's store slice), and coming
 * back is a pointer swap — no reload, no visible gap.
 *
 * A subscription is either the original POST /chat/stream connection (the
 * turn was sent from this page) or a POST /chat/resume replay starting from
 * event 0 (the turn pre-exists this page: refresh, switch-back, or a
 * re-attach after the send connection dropped).
 */

// ---------------------------------------------------------------------------
// Low-level SSE openers (fetch + manual frame parsing; EventSource cannot
// POST or carry custom headers)
// ---------------------------------------------------------------------------

interface LowHandlers {
  onEvent: (event: SSEEventName, data: any, eventId?: number) => void
  onError?: (error: Error) => void
  onDone?: () => void
  /** Called once when a live SSE body is confirmed (HTTP 200 + event-stream). */
  onActive?: () => void
}

async function consumeSSE(response: Response, handlers: LowHandlers): Promise<void> {
  const reader = response.body?.getReader()
  if (!reader) {
    handlers.onError?.(new Error('No response body'))
    return
  }

  handlers.onActive?.()

  const decoder = new TextDecoder()
  let buffer = ''
  let currentEvent = 'message'
  let currentId: number | undefined

  while (true) {
    const { done, value } = await reader.read()
    if (done) break

    buffer += decoder.decode(value, { stream: true })
    const lines = buffer.split('\n')
    buffer = lines.pop() || ''

    for (const line of lines) {
      if (line.startsWith('id:')) {
        const n = parseInt(line.slice(3).trim(), 10)
        currentId = Number.isNaN(n) ? undefined : n
      } else if (line.startsWith('event:')) {
        currentEvent = line.slice(6).trim()
      } else if (line.startsWith('data:')) {
        const raw = line.slice(5).trim()
        let data: any
        try {
          data = JSON.parse(raw)
        } catch {
          data = { raw }
        }
        handlers.onEvent(currentEvent as SSEEventName, data, currentId)
        currentEvent = 'message'
        currentId = undefined
      }
    }
  }
}

function openSendStream(body: StreamChatRequest, handlers: LowHandlers): AbortController {
  const controller = new AbortController()

  const run = async () => {
    try {
      const response = await fetch('/api/v1/chat/stream', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ stream_response: true, source: 'web', ...body }),
        signal: controller.signal,
      })
      if (!response.ok) {
        handlers.onError?.(new Error(`HTTP ${response.status}: ${await response.text().catch(() => 'Unknown error')}`))
        return
      }
      await consumeSSE(response, handlers)
      handlers.onDone?.()
    } catch (error: any) {
      if (error?.name === 'AbortError') {
        handlers.onDone?.()
        return
      }
      handlers.onError?.(error instanceof Error ? error : new Error(String(error)))
      handlers.onDone?.()
    }
  }

  run()
  return controller
}

/**
 * Opens POST /chat/resume for *sessionId* replaying from *fromEventId*.
 * When no task exists the backend answers with plain JSON (TASK_NOT_FOUND);
 * the promise resolves with 'none' in that case.
 */
async function openResumeStream(
  sessionId: string,
  fromEventId: number,
  handlers: LowHandlers,
): Promise<AbortController | 'none'> {
  const controller = new AbortController()
  let settled = false

  const run = async () => {
    try {
      const response = await fetch('/api/v1/chat/resume', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ session_id: sessionId, source: 'web', from_event_id: fromEventId }),
        signal: controller.signal,
      })
      if (!response.ok) {
        handlers.onError?.(new Error(`HTTP ${response.status}`))
        return
      }
      const contentType = response.headers.get('content-type') || ''
      if (!contentType.includes('text/event-stream')) {
        // JSON result (e.g. TASK_NOT_FOUND) — no task to attach to.
        settled = true
        handlers.onDone?.()
        return
      }
      await consumeSSE(response, handlers)
      handlers.onDone?.()
    } catch (error: any) {
      if (error?.name === 'AbortError') {
        handlers.onDone?.()
        return
      }
      handlers.onError?.(error instanceof Error ? error : new Error(String(error)))
      handlers.onDone?.()
    }
  }

  void run()
  // Give the request a beat to answer JSON before the caller assumes a live
  // stream; a TASK_NOT_FOUND reply normally arrives within milliseconds.
  await new Promise<void>(resolve => window.setTimeout(resolve, 250))
  return settled ? 'none' : controller
}

/** Ask the backend to halt an in-flight generation. */
async function requestStop(sessionId: string): Promise<void> {
  await fetch('/api/v1/chat/stop', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ session_id: sessionId }),
  }).catch(() => {})
}

/**
 * Answer a pending ``user-interaction`` (e.g. the agent's ``ask_user``).
 * *input* is one inner array of answer values per question — choice keys
 * ("1", "2", …) for predefined options, or free text. The backend resolves
 * the broker future, which unblocks the (otherwise stuck) run.
 */
export async function submitUserInteraction(
  sessionId: string,
  interactionKey: string,
  input: string[][],
): Promise<{ ok: boolean; error?: string }> {
  try {
    const response = await fetch('/api/v1/chat/user_interaction', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ session_id: sessionId, interaction_key: interactionKey, input }),
    })
    const data: any = await response.json().catch(() => null)
    if (response.ok && data?.success) return { ok: true }
    return { ok: false, error: data?.errorMessage || `HTTP ${response.status}` }
  } catch (e: any) {
    return { ok: false, error: e?.message || '网络错误' }
  }
}

// ---------------------------------------------------------------------------
// Subscription manager
// ---------------------------------------------------------------------------

interface Sub {
  key: string // session id, or '' for a new chat whose id is still resolving
  source: 'send' | 'resume'
  controller: AbortController
  startedAt: number
  lastEventAt: number | null
  terminal: boolean
  /** Bumped on each re-attach; caps how long we keep retrying a dead task link. */
  attempts: number
  /** True once openResumeStream answered JSON (TASK_NOT_FOUND). */
  noTask: boolean
}

const subs = new Map<string, Sub>()

/** Re-attach backoff schedule after a connection dies mid-turn. */
const REATTACH_DELAYS = [1000, 3000, 5000]
/** No event (running tasks ping every 10 s) for this long ⇒ connection dead. */
const STALE_AFTER_FIRST_EVENT_MS = 45000
/** A resume replay / fresh send should yield its first event quickly. */
const STALE_BEFORE_FIRST_EVENT_MS = 25000
const WATCHDOG_INTERVAL_MS = 15000

let watchdogStarted = false

function sink(key: string, event: SSEEventName, data: any): void {
  useChatStore.getState().applySSEEvent(key, event, data)
}

function removeSubIf(key: string, sub: Sub): boolean {
  if (subs.get(key) !== sub) return false
  subs.delete(key)
  return true
}

function rekeySub(sub: Sub, newKey: string): void {
  if (subs.get(newKey)) return // already occupied (defensive)
  subs.delete(sub.key)
  sub.key = newKey
  subs.set(newKey, sub)
}

function scheduleReattach(key: string, attempts: number): void {
  if (!key || subs.has(key) || attempts >= REATTACH_DELAYS.length) return
  const delay = REATTACH_DELAYS[attempts]
  window.setTimeout(() => {
    if (!subs.has(key)) attachSessionStream(key, attempts + 1)
  }, delay)
}

function startWatchdog(): void {
  if (watchdogStarted) return
  watchdogStarted = true
  window.setInterval(() => {
    const now = Date.now()
    for (const sub of subs.values()) {
      const limit = sub.lastEventAt === null ? STALE_BEFORE_FIRST_EVENT_MS : STALE_AFTER_FIRST_EVENT_MS
      if (now - sub.startedAt > limit && (sub.lastEventAt === null || now - sub.lastEventAt > limit)) {
        // Half-open TCP or a hung backend: tear down and re-attach (a healthy
        // running task would have pinged by now).
        sub.controller.abort()
        scheduleReattach(sub.key, sub.attempts)
      }
    }
  }, WATCHDOG_INTERVAL_MS)
}

/**
 * Register the send connection for *body*'s session as that session's
 * subscription. Events route straight into the store's per-session slice, so
 * the turn keeps updating even while the user views another session.
 */
export function sendChat(body: StreamChatRequest): void {
  startWatchdog()
  let sub: Sub
  let controller: AbortController

  controller = openSendStream(body, {
    onEvent: (event, data) => {
      sub.lastEventAt = Date.now()
      if (event === 'session' && data?.session_id && sub.key !== data.session_id) {
        // New chat: the server assigned the real id. Rename the store slice
        // first (it owns sessionId + cache), then the manager's own slot.
        sink(sub.key, event, data)
        rekeySub(sub, data.session_id)
        return
      }
      if (event === 'end' || event === 'error') sub.terminal = true
      sink(sub.key, event, data)
    },
    onError: (error) => {
      // Transport failure on a fresh send: surface it as a visible error.
      if (!sub.terminal) sink(sub.key, 'error', { error: error.message, error_type: 'ClientError' })
    },
    onDone: () => {
      if (sub.terminal || sub.noTask) {
        removeSubIf(sub.key, sub)
        return
      }
      // The send connection dropped mid-turn (network blip, tab slept…). The
      // backend task keeps running — take the event buffer over via resume.
      removeSubIf(sub.key, sub)
      if (sub.key) scheduleReattach(sub.key, sub.attempts)
    },
  })

  sub = {
    key: body.session_id || '',
    source: 'send',
    controller,
    startedAt: Date.now(),
    lastEventAt: null,
    terminal: false,
    attempts: 0,
    noTask: false,
  }
  // A brand-new send supersedes any stale subscription on the same session
  // (e.g. a finished-turn replay still draining from the TTL window).
  const prev = subs.get(sub.key)
  if (prev) prev.controller.abort()
  subs.set(sub.key, sub)
}

/**
 * Ensure a live subscription for *sessionId*, creating a from-event-0 replay
 * when none exists. Idempotent: an existing subscription (the original send
 * stream or a previous attach) is left untouched, so callers may invoke this
 * on every visit to a session.
 *
 * The replay re-emits the whole in-memory turn — including subagent steps —
 * and the store truncates the tail of the current turn before applying it
 * (beginTurnReplay), so history + replay never double-render.
 */
export function attachSessionStream(sessionId: string, attempts = 0): void {
  if (!sessionId || subs.has(sessionId)) return
  startWatchdog()

  // Claim the slot IMMEDIATELY (before the request resolves) so concurrent
  // attaches / a racing send cannot open a second consumer on the same task.
  const sub: Sub = {
    key: sessionId,
    source: 'resume',
    controller: new AbortController(), // placeholder until the request resolves
    startedAt: Date.now(),
    lastEventAt: null,
    terminal: false,
    attempts,
    noTask: false,
  }
  subs.set(sessionId, sub)

  let sawActive = false
  let replayStarted = false

  void openResumeStream(sessionId, 0, {
    onActive: () => {
      sawActive = true
      // resume only answers with an event stream when a live task exists (or
      // a finished one still within its TTL window). Mark the turn active
      // now; the replayed end/error event clears it when the turn is over.
      useChatStore.getState().setSessionStreaming(sessionId, true)
    },
    onEvent: (event, data) => {
      sub.lastEventAt = Date.now()
      if (!replayStarted && event !== 'ping') {
        // First real event of the replay: drop the (partially persisted) tail
        // of the current turn so the replayed events rebuild it cleanly.
        replayStarted = true
        useChatStore.getState().beginTurnReplay(sessionId)
      }
      if (event === 'end' || event === 'error') sub.terminal = true
      sink(sessionId, event, data)
    },
    onDone: () => {
      if (!removeSubIf(sessionId, sub)) return // a newer attach/send took the slot
      if (!sawActive) return // TASK_NOT_FOUND JSON (or request failed) — nothing to resume
      if (sub.terminal) return
      // Connected, then dropped before a terminal event: back off and retry.
      scheduleReattach(sessionId, sub.attempts)
    },
  }).then(result => {
    if (result === 'none') {
      sub.noTask = true
      removeSubIf(sessionId, sub)
      return
    }
    if (subs.get(sessionId) !== sub) {
      // Replaced while the request was in flight (send took over, navigated).
      result.abort()
      return
    }
    sub.controller = result
  })
}

/**
 * Explicit stop (stop button): tell the backend to halt AND sever the local
 * subscription. The backend emits a terminal event which the still-open
 * stream would consume before the abort lands.
 */
export function stopSessionStream(key: string): void {
  // '' is a valid key: a just-sent new chat whose id is still resolving.
  const sub = subs.get(key)
  if (sub) {
    sub.terminal = true
    sub.controller.abort()
    subs.delete(sub.key)
    if (sub.key) void requestStop(sub.key)
  }
  useChatStore.getState().setSessionStreaming(key, false)
}

/**
 * Sever the local subscription for *key* without touching the backend task.
 * Used when a new send supersedes a stale replay on the same session.
 */
export function detachSessionStream(key: string): void {
  const sub = key ? subs.get(key) : null
  if (!sub) return
  subs.delete(sub.key)
  sub.controller.abort()
}

/** True when a live SSE subscription exists for *key*. */
export function hasSessionStream(key: string): boolean {
  return key !== '' && subs.has(key)
}
