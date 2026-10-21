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
