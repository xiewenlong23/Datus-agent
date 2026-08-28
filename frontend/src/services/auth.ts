export interface FeishuUser {
  open_id: string
  name: string
  en_name?: string
  email?: string
  avatar_url?: string
}

export interface MeResponse {
  authenticated: boolean
  feishu_enabled: boolean
  user: FeishuUser | null
}

/**
 * Current login state. Returns null when the backend is unreachable so the
 * UI can degrade gracefully instead of blocking on a dead server.
 */
export async function fetchMe(): Promise<MeResponse | null> {
  try {
    const res = await fetch('/api/v1/auth/me', { credentials: 'same-origin' })
    if (!res.ok) return null
    return (await res.json()) as MeResponse
  } catch {
    return null
  }
}

/** Send the browser to the Feishu QR-code authorize page (full-page redirect). */
export function loginWithFeishu(): void {
  window.location.href = '/api/v1/auth/feishu/login'
}

export async function logout(): Promise<void> {
  await fetch('/api/v1/auth/logout', { method: 'POST', credentials: 'same-origin' }).catch(() => {})
}

/** Error the backend may attach when the Feishu flow fails (?login_error=…). */
export function loginErrorFromUrl(): string | null {
  const params = new URLSearchParams(window.location.search)
  const err = params.get('login_error')
  if (err) {
    // Drop the param so a refresh doesn't re-show a stale error.
    window.history.replaceState({}, '', window.location.pathname)
  }
  return err
}
