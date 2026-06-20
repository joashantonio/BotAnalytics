// Neutral chart colours (background / grid / text / border) that must follow
// the app theme. Series colours (candles, PSAR, buy/sell pins…) are defined
// per-chart and stay the same in both themes — only the canvas chrome flips.

export interface ChartChrome {
  bg: string
  grid: string
  text: string
  border: string
}

export function isLight(): boolean {
  return document.documentElement.classList.contains('light')
}

/** Chrome for a given theme. Pass the theme explicitly where available — the
 * <html> class lags by one commit (child effects run before the provider's),
 * so reading the DOM during a chart effect can see the stale theme. Falls back
 * to the DOM class only when no theme is passed. */
export function chartChrome(theme?: 'dark' | 'light'): ChartChrome {
  const light = theme ? theme === 'light' : isLight()
  return light
    ? { bg: '#ffffff', grid: '#e8eaef', text: '#475569', border: '#d8dce4' }
    : { bg: '#1a1d23', grid: '#2d3240', text: '#94a3b8', border: '#2d3240' }
}
