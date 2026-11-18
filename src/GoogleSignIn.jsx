import { useEffect, useRef, useState } from 'react'
import { customerApi } from './storeApi'

// "Sign in with Google" (Google Identity Services). The server hands out the
// public Client ID and a one-time nonce; the Google script renders its own
// button and returns a signed ID token that the server verifies. Nothing shows
// when the store has no Client ID or the script cannot load.
const GIS_URL = 'https://accounts.google.com/gsi/client'
let scriptPromise = null

function loadGoogleScript() {
  if (window.google?.accounts?.id) return Promise.resolve(window.google)
  scriptPromise ??= new Promise((resolve, reject) => {
    const script = document.createElement('script')
    script.src = GIS_URL
    script.async = true
    script.onload = () => window.google?.accounts?.id ? resolve(window.google) : reject(new Error('Google indisponível'))
    script.onerror = () => { scriptPromise = null; reject(new Error('Google indisponível')) }
    document.head.appendChild(script)
  })
  return scriptPromise
}

export default function GoogleSignIn({ mode = 'signin', acceptTerms = false, divider = 'ou', onSuccess, onError }) {
  const slot = useRef(null)
  const latest = useRef({})
  latest.current = { acceptTerms, onSuccess, onError }
  const [ready, setReady] = useState(false)
  const [busy, setBusy] = useState(false)
  // Each attempt consumes the nonce, so a failed one asks for a fresh button.
  const [round, setRound] = useState(0)

  useEffect(() => {
    let active = true
    ;(async () => {
      try {
        const config = await customerApi('/api/customer/google/config')
        if (!active) return
        if (!config?.available || !config.client_id || !config.nonce) { setReady(false); return }
        const google = await loadGoogleScript()
        if (!active || !slot.current) return
        google.accounts.id.initialize({
          client_id: config.client_id,
          nonce: config.nonce,
          ux_mode: 'popup',
          context: mode === 'signup' ? 'signup' : 'signin',
          auto_select: false,
          itp_support: true,
          callback: async ({ credential } = {}) => {
            if (!credential || !active) return
            setBusy(true)
            try {
              const data = await customerApi('/api/customer/google', { method: 'POST', body: { credential, accept_terms: latest.current.acceptTerms === true } })
              latest.current.onSuccess?.(data)
            } catch (error) {
              latest.current.onError?.(error)
              if (active) setRound(value => value + 1)
            } finally { if (active) setBusy(false) }
          }
        })
        // The wrapper stays hidden until the button exists, so measure the form around it.
        const host = slot.current.parentElement?.parentElement
        const style = host ? getComputedStyle(host) : null
        const inner = host ? host.clientWidth - parseFloat(style.paddingLeft || 0) - parseFloat(style.paddingRight || 0) : 0
        const width = Math.max(200, Math.min(400, Math.floor(inner || 320)))
        slot.current.replaceChildren()
        google.accounts.id.renderButton(slot.current, {
          type: 'standard',
          theme: document.documentElement.dataset.theme === 'light' ? 'outline' : 'filled_black',
          size: 'large',
          text: mode === 'signup' ? 'signup_with' : 'continue_with',
          shape: 'pill',
          logo_alignment: 'left',
          width,
          locale: 'pt-BR'
        })
        setReady(true)
      } catch {
        if (active) setReady(false)
      }
    })()
    return () => { active = false }
  }, [mode, round])

  return (
    <div className="account-google" data-ready={ready ? 'true' : 'false'}>
      <div ref={slot} className="account-google-button" />
      {ready && busy && <p className="account-hint" role="status">Entrando com o Google…</p>}
      {ready && divider && <p className="account-divider"><span>{divider}</span></p>}
    </div>
  )
}
