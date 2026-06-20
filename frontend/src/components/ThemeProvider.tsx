import { useEffect, useState, type ReactNode } from 'react'
import { ThemeContext, THEME_KEY, type Theme } from '../hooks/useTheme'
import { lsGet, lsSet } from '../lib/storage'

/** Owns the app theme and keeps the <html> `light` class + localStorage in
 * sync. Wrap the app once so all consumers share one state. */
export default function ThemeProvider({ children }: { children: ReactNode }) {
  // Light is the default; only an explicit saved 'dark' opts out.
  const [theme, setTheme] = useState<Theme>(() => (lsGet(THEME_KEY) === 'dark' ? 'dark' : 'light'))

  useEffect(() => {
    document.documentElement.classList.toggle('light', theme === 'light')
    lsSet(THEME_KEY, theme)
  }, [theme])

  const toggle = () => setTheme((t) => (t === 'dark' ? 'light' : 'dark'))

  return <ThemeContext.Provider value={{ theme, toggle }}>{children}</ThemeContext.Provider>
}
