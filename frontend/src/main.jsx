import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App sessionCheckMs={Number(import.meta.env.VITE_SESSION_CHECK_MS) || undefined} />
  </StrictMode>,
)
