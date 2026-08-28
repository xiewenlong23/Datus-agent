import { useEffect, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import ChatArea from '../components/ChatArea'
import { useChatStore } from '../stores/chatStore'
import { getChatHistory } from '../services/sessions'
import { attachSessionStream } from '../services/chat'

/**
 * Session load / re-attach logic.
 *
 * Switching between sessions is a pointer swap: each session's messages live
 * in its own store slice (sessionCaches), and each RUNNING session keeps a
 * live SSE subscription that updates its slice in the background. So
 * revisiting a session is instant (cache hit, no fetch), and a session that
 * started elsewhere (refresh, other tab) is restored by a from-event-0
 * replay attached right after the history snapshot lands.
 */
export default function ChatPage() {
  const [searchParams, setSearchParams] = useSearchParams()
  const {
    sessionId, setSessionId, clearNewChat, setSelectedAgent, setMessagesFor,
  } = useChatStore()
  const [historyLoading, setHistoryLoading] = useState(false)
  const lastLoadedRef = useRef<string | null>(null)

  const sessionFromUrl = searchParams.get('session')
  const subagentFromUrl = searchParams.get('subagent')

  // React to URL changes: load the requested session, or reset for a new chat.
  useEffect(() => {
    if (subagentFromUrl) setSelectedAgent(subagentFromUrl)

    if (!sessionFromUrl) {
      if (lastLoadedRef.current !== null) {
        lastLoadedRef.current = null
        clearNewChat()
      }
      return
    }

    if (sessionFromUrl === lastLoadedRef.current) return
    lastLoadedRef.current = sessionFromUrl
    setSessionId(sessionFromUrl)

    // Cache hit (visited before in this page lifetime, and its subscription
    // keeps it current): render immediately, no history fetch, no loading
    // state. This is what makes A → B → A switching seamless.
    const cached = useChatStore.getState().sessionCaches[sessionFromUrl]
    if (cached && cached.length > 0) {
      attachSessionStream(sessionFromUrl) // idempotent: no-op if a sub exists
      return
    }

    setHistoryLoading(true)
    // Attach AFTER the history snapshot is in place: the replay truncates
    // the tail of the current turn and rebuilds it from the event buffer,
    // so the two must not interleave.
    getChatHistory(sessionFromUrl)
      .then(history => {
        // The user may have navigated away while the fetch was in flight —
        // a stale response must not clobber the newer session's view.
        if (useChatStore.getState().sessionId !== sessionFromUrl) return
        setMessagesFor(sessionFromUrl, history)
        attachSessionStream(sessionFromUrl)
      })
      .catch(() => {
        if (useChatStore.getState().sessionId === sessionFromUrl) {
          attachSessionStream(sessionFromUrl)
        }
      })
      .finally(() => setHistoryLoading(false))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionFromUrl, subagentFromUrl])

  // When the stream assigns a real session id (new chat), write it into the
  // URL so the address bar doubles as the share link.
  useEffect(() => {
    if (sessionId && sessionId !== sessionFromUrl) {
      lastLoadedRef.current = sessionId
      const next = new URLSearchParams(searchParams)
      next.set('session', sessionId)
      setSearchParams(next, { replace: true })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId])

  return (
    <div className="chat-page-body">
      {historyLoading ? (
        <div className="chat-history-loading">加载会话历史…</div>
      ) : (
        <ChatArea />
      )}
    </div>
  )
}
