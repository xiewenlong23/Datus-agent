import { create } from 'zustand'
import { fetchMe, type FeishuUser, type MeResponse } from '../services/auth'

interface UserState {
  /** 'loading' until /auth/me has answered (or been given up on). */
  status: 'loading' | 'ready'
  /** False when the backend has no Feishu login configured (legacy mode). */
  feishuEnabled: boolean
  authenticated: boolean
  user: FeishuUser | null
  init: () => Promise<void>
  /** Local teardown after logout (the backend cookie is already cleared). */
  clear: () => void
  /** Re-check after a full-page redirect back from Feishu. */
  refresh: () => Promise<void>
}

export const useUserStore = create<UserState>((set) => ({
  status: 'loading',
  feishuEnabled: false,
  authenticated: false,
  user: null,

  init: async () => {
    const me: MeResponse | null = await fetchMe()
    apply(me, set)
  },

  refresh: async () => {
    const me = await fetchMe()
    apply(me, set)
  },

  clear: () => set({ feishuEnabled: true, authenticated: false, user: null }),
}))

function apply(me: MeResponse | null, set: (partial: Partial<UserState>) => void): void {
  if (me === null) {
    // Backend unreachable: don't gate the UI on it.
    set({ status: 'ready', feishuEnabled: false, authenticated: false, user: null })
    return
  }
  set({
    status: 'ready',
    feishuEnabled: me.feishu_enabled,
    authenticated: me.authenticated,
    user: me.user,
  })
}
