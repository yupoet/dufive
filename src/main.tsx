import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import '@fontsource/zcool-kuaile'
import { registerSW } from 'virtual:pwa-register'
import App from './App'
import { notifyUpdateReady } from './ui/UpdateToast'
import './index.css'

registerSW({ immediate: true, onNeedRefresh: notifyUpdateReady })

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
