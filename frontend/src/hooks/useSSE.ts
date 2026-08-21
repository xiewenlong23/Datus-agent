import { useCallback, useEffect, useRef, useState } from 'react'

interface UseSSEOptions {
  onEvent: (event: string, data: any) => void
  onError?: (error: Error) => void
  onDone?: () => void
  maxRetries?: number
}

/**
 * Hook for consuming SSE streams from `/api/v1/chat/stream`.
 * Handles reconnection with exponential backoff (max 3 retries).
 * P3 will wire this into the chat flow; P1 uses a stub.
 */
export function useSSE({ onEvent, onError, onDone, maxRetries = 3 }: UseSSEOptions) {
  const [isConnected, setIsConnected] = useState(false)
  const [retryCount, setRetryCount] = useState(0)
  const controllerRef = useRef<AbortController | null>(null)
  const handlersRef = useRef({ onEvent, onError, onDone })
  handlersRef.current = { onEvent, onError, onDone }

  const stop = useCallback(() => {
    controllerRef.current?.abort()
    controllerRef.current = null
    setIsConnected(false)
  }, [])

  useEffect(() => {
    return () => {
      controllerRef.current?.abort()
    }
  }, [])

  const connect = useCallback(async (url: string, body: Record<string, unknown>) => {
    stop()
    setRetryCount(0)
    setIsConnected(true)

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`)
      }

      const reader = response.body?.getReader()
      if (!reader) throw new Error('No response body')

      const decoder = new TextDecoder()
      let buffer = ''
      let currentEvent = 'message'

      while (true) {
        const { done, value } = await reader.read()
        if (done) break

        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n')
        buffer = lines.pop() || ''

        for (const line of lines) {
          if (line.startsWith('event: ')) {
            currentEvent = line.slice(7).trim()
          } else if (line.startsWith('data: ')) {
            const raw = line.slice(6).trim()
            if (raw === '[DONE]') {
              handlersRef.current.onDone?.()
              continue
            }
            try {
              const data = JSON.parse(raw)
              handlersRef.current.onEvent(currentEvent, data)
            } catch {
              handlersRef.current.onEvent(currentEvent, { raw })
            }
            currentEvent = 'message'
          }
        }
      }

      setIsConnected(false)
      handlersRef.current.onDone?.()
    } catch (error: any) {
      if (error.name === 'AbortError') return

      setRetryCount(prev => {
        const next = prev + 1
        if (next <= maxRetries) {
          const delay = Math.min(1000 * 2 ** next, 8000)
          setTimeout(() => {
            setRetryCount(0)
            connect(url, body)
          }, delay)
          return next
        }
        handlersRef.current.onError?.(error)
        return next
      })
    } finally {
      setIsConnected(false)
    }
  }, [stop, maxRetries])

  return { connect, stop, isConnected, retryCount }
}