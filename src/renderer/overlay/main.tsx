import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import '../common/styles.css'
import { OverlayApp } from './App'

document.documentElement.classList.add('lud-overlay')
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <OverlayApp />
  </StrictMode>
)
