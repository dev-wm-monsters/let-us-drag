import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import '../common/styles.css'
import '../common/windows.css'
import { SettingsApp } from './App'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <SettingsApp />
  </StrictMode>
)
