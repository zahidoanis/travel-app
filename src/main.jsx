import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './theme'
import App from './App'
import './styles.css'
// After styles.css: every rule in it is scoped to [data-theme="night"], so it
// only ever adds to the base design, never replaces it (see theme.js).
import './theme-night.css'

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>
)
