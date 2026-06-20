import { createContext, useContext } from 'react'

export type Theme = 'dark' | 'light'
export const THEME_KEY = 'th:theme'

export interface ThemeCtx {
  theme: Theme
  toggle: () => void
}

// Single source of truth, provided by ThemeProvider (see ThemeProvider.tsx) so
// every consumer — Navbar button, charts — shares one state and re-renders
// together on toggle.
export const ThemeContext = createContext<ThemeCtx>({ theme: 'light', toggle: () => {} })

export function useTheme(): ThemeCtx {
  return useContext(ThemeContext)
}
