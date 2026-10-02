import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './theme'
import App from './App'
import './fonts.css'
import './styles.css'
// After styles.css: every rule in these is scoped to its own [data-theme], so
// they only ever add to the base design, never replace it (see theme.js).
import './theme-night.css'
import './theme-gold.css'
import './theme-cream.css'

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>
)

// Keeps the app's own files for offline use (see public/sw.js). Production
// only: in development it would serve yesterday's build over today's edits.
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {
      /* no offline shell — the app works exactly as before */
    })
  })
}
