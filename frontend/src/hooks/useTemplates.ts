import { useEffect, useState } from 'react'
import { fetchTemplates } from '../services/templates'
import { useChatStore } from '../stores/chatStore'

/**
 * Loads task templates from the backend API.
 * Falls back to the store's existing templates on failure.
 * P2 wires this to the real /templates/list endpoint.
 */
export function useTemplates() {
  const { templates, setTemplates } = useChatStore()
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<Error | null>(null)

  useEffect(() => {
    let cancelled = false

    async function load() {
      setLoading(true)
      try {
        const remote = await fetchTemplates()
        if (!cancelled && remote.length > 0) {
          setTemplates(remote)
        }
      } catch (e: any) {
        if (!cancelled) setError(e)
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    load()
    return () => { cancelled = true }
  }, [setTemplates])

  return { templates, loading, error }
}