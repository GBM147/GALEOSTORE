import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import App from './App'
import { initLiteMode } from './liteMode'
import { prefetchStorefrontJson } from './storefrontData'
import { STORE_API_BASE } from './storeApi'
import './styles.css'
import './form-controls.css'

// Before the first paint, so the light version never flashes the full one.
initLiteMode()

// The published Home needs these three responses before it can show the
// banner. Start them now instead of after the first React render.
if (window.location.pathname === '/' && new URLSearchParams(window.location.search).get('preview') !== 'draft') {
  prefetchStorefrontJson(STORE_API_BASE + '/api/store')
  prefetchStorefrontJson('/api/store/home', { credentials:'include' })
  prefetchStorefrontJson('/api/store/home/settings', { credentials:'include' })
}

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </StrictMode>
)
