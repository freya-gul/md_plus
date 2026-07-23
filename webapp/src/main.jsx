import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'

// Polyfill the `window.storage` API this component was originally written
// against (Claude artifact sandbox) with a localStorage-backed version.
window.storage = {
  async get(key) {
    const value = localStorage.getItem(key)
    return value === null ? null : { value }
  },
  async set(key, value) {
    localStorage.setItem(key, value)
  },
}

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
