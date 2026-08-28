import { create } from 'zustand'

export type Theme = 'dark' | 'light'

const STORAGE_KEY = 'datus-theme'

function getInitialTheme(): Theme {
  try {
    const saved = localStorage.getItem(STORAGE_KEY)
    if (saved === 'light' || saved === 'dark') return saved
  } catch {
    // localStorage unavailable (private mode, etc.) — fall back to dark
  }
  return 'dark'
}

function applyTheme(theme: Theme) {
  document.documentElement.setAttribute('data-theme', theme)
}

interface ThemeState {
  theme: Theme
  toggle: () => void
}

export const useThemeStore = create<ThemeState>((set, get) => ({
  theme: getInitialTheme(),
  toggle: () => {
    const next: Theme = get().theme === 'dark' ? 'light' : 'dark'
    applyTheme(next)
    try {
      localStorage.setItem(STORAGE_KEY, next)
    } catch {
      // ignore persistence failures
    }
    set({ theme: next })
  },
}))

// Reflect the saved choice as soon as the store module loads,
// before the first render paints.
applyTheme(getInitialTheme())
