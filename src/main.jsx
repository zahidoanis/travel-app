import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './theme'
import App from './App'
import './styles.css'
// After styles.css: every rule in these is scoped to its own [data-theme], so
// they only ever add to the base design, never replace it (see theme.js).
import './theme-night.css'
import './theme-gold.css'

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>
)
