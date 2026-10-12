import { useEffect, useId, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import './NewsletterSignup.css'

async function newsletterRequest(action, body) {
  const response = await fetch('/api/store/newsletter/' + action, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    credentials: 'same-origin',
    cache: 'no-store'
  })
  let result
  try { result = await response.json() } catch {}
  if (!response.ok) throw new Error(result?.error || 'Não foi possível concluir esta ação. Tente novamente mais tarde.')
  return result
}

export default function NewsletterSignup({ buttonLabel = 'Entrar' }) {
  const id = useId()
  const [email, setEmail] = useState('')
  const [sending, setSending] = useState(false)
  const [notice, setNotice] = useState('')
  const [error, setError] = useState('')
  const inFlight = useRef(false)

  async function subscribe(event) {
    event.preventDefault()
    if (inFlight.current) return
    inFlight.current = true
    setSending(true)
    setNotice('')
    setError('')
    try {
      const result = await newsletterRequest('subscribe', { email })
      if (!result?.accepted) throw new Error('Não foi possível concluir a inscrição. Tente novamente mais tarde.')
      setNotice('Confira seu e-mail para confirmar a inscrição. Ela só será ativada após a confirmação.')
    } catch (failure) { setError(failure.message) }
    finally { inFlight.current = false; setSending(false) }
  }

  return (
    <div className="newsletter-signup">
      <form onSubmit={subscribe} aria-label="Receber novidades da GALEO" aria-busy={sending}>
        <input id={id} type="email" value={email} onChange={event => { setEmail(event.target.value); setNotice(''); setError('') }}
          placeholder="Seu melhor e-mail" aria-label="Seu melhor e-mail" autoComplete="email" maxLength={254} required
          aria-describedby={id + '-notice'} disabled={sending} />
        <button type="submit" disabled={sending}>{sending ? 'Enviando…' : buttonLabel + ' ↗'}</button>
      </form>
      <p id={id + '-notice'} className="newsletter-signup-notice" role={error ? 'alert' : 'status'}>{error || notice}</p>
      <small>Você confirma por e-mail e pode cancelar a inscrição a qualquer momento.</small>
    </div>
  )
}

export function NewsletterConfirmation() {
  // Reading the fragment does not submit it. Even scanners executing JavaScript
  // must not confirm or cancel an inscription merely by opening the page.
  const [request] = useState(() => {
    const fragment = new URLSearchParams(window.location.hash.slice(1))
    const action = fragment.has('unsubscribe') ? 'unsubscribe' : 'confirm'
    const token = fragment.get(action) || ''
    return { action, token: /^[a-f0-9]{64}$/.test(token) ? token : '' }
  })
  useEffect(() => { window.history.replaceState(null, '', window.location.pathname + window.location.search) }, [])
  const [working, setWorking] = useState(false)
  const [done, setDone] = useState(false)
  const [error, setError] = useState('')
  const inFlight = useRef(false)
  const unsubscribe = request.action === 'unsubscribe'

  async function perform() {
    if (inFlight.current || done || !request.token) return
    inFlight.current = true
    setWorking(true)
    setError('')
    try {
      const result = await newsletterRequest(request.action, { token: request.token })
      if (result?.status !== (unsubscribe ? 'unsubscribed' : 'confirmed')) throw new Error('Não foi possível concluir esta ação. Tente novamente mais tarde.')
      setDone(true)
    } catch (failure) { setError(failure.message) }
    finally { inFlight.current = false; setWorking(false) }
  }

  return (
    <main className="newsletter-confirmation section-shell">
      <span className="eyebrow">GALEO / INSIDER</span>
      <h1>{unsubscribe ? 'Cancelar inscrição' : 'Confirmar inscrição'}</h1>
      {done ? <p role="status">{unsubscribe ? 'Sua inscrição foi cancelada.' : 'Inscrição confirmada. Você poderá receber novidades da GALEO.'}</p>
        : request.token ? <>
          <p>{unsubscribe ? 'Ao confirmar, você deixa de receber novidades da GALEO.' : 'Confirme que deseja receber novidades da loja por e-mail.'}</p>
          <button type="button" className="button-primary" onClick={perform} disabled={working}>{working ? 'Aguarde…' : unsubscribe ? 'Confirmar cancelamento' : 'Confirmar minha inscrição'}</button>
        </> : <p role="alert">Este link é inválido. Abra o link completo recebido por e-mail ou solicite uma nova inscrição na Home.</p>}
      {error && <p role="alert" className="newsletter-confirmation-error">{error}</p>}
      <Link to="/">Voltar à loja</Link>
    </main>
  )
}
