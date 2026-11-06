import '../common/crash' // D28: first, so errors during start-up are reported too
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import '../common/styles.css'
import '../common/windows.css'
import { FeedApp } from './App'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <FeedApp />
  </StrictMode>
)
