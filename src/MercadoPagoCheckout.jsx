import { useCallback, useEffect, useId, useRef, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { customerApi } from './storeApi'
import usePostalCodeAddress from './usePostalCodeAddress'
import './mercado-pago-checkout.css'
import CheckoutSteps from './CheckoutSteps'
import { CardIcon, LockIcon, QrIcon } from './icons'
import { usePageMeta } from './pageMeta'

const money = value => Number(value || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
const sdkUrl = 'https://sdk.mercadopago.com/js/v2'
const deviceSdkUrl = 'https://www.mercadopago.com/v2/security.js'
const states = ['AC', 'AL', 'AP', 'AM', 'BA', 'CE', 'DF', 'ES', 'GO', 'MA', 'MT', 'MS', 'MG', 'PA', 'PB', 'PR', 'PE', 'PI', 'RJ', 'RN', 'RS', 'RO', 'RR', 'SC', 'SP', 'SE', 'TO']
const emptyBuyerAddress = () => ({ postal_code: '', street: '', number: '', neighborhood: '', city: '', state: '', complement: '' })
let sdkPromise
let deviceScript

// The official collector's session IDs contain dots (e.g. "armor.<hash>.<hash>").
// The SDK refuses invalid card data before creating a token and does not call
// onSubmit, so its errors must be shown here or the button seems to do nothing.
const cardFieldLabels = [
  ['cardNumber', 'o número do cartão'], ['expiration', 'a validade'], ['securityCode', 'o código de segurança'],
  ['cardholderName', 'o nome no cartão'], ['identification', 'o CPF']
]
const cardErrorCodes = { 205: 'o número do cartão', E301: 'o número do cartão', 208: 'a validade', 209: 'a validade', 325: 'a validade', 326: 'a validade', 212: 'o CPF', 213: 'o CPF', 214: 'o CPF', 322: 'o CPF', 323: 'o CPF', 324: 'o CPF', 221: 'o nome no cartão', 316: 'o nome no cartão', 224: 'o código de segurança', E302: 'o código de segurança', E203: 'o código de segurança' }
export function cardDataError(error) {
  const found = new Set(), seen = new Set()
  const visit = value => {
    if (value == null || seen.has(value)) return
    if (typeof value === 'object') seen.add(value)
    if (Array.isArray(value)) return value.forEach(visit)
    if (typeof value === 'string' || typeof value === 'number') {
      const text = String(value)
      if (cardErrorCodes[text]) found.add(cardErrorCodes[text])
      for (const [key, label] of cardFieldLabels) if (text.includes(key)) found.add(label)
      return
    }
    if (typeof value === 'object') for (const key of ['field', 'code', 'cause', 'message', 'description', 'fieldErrors', 'error', 'errors']) visit(value[key])
  }
  visit(error)
  return found.size ? 'Confira ' + [...found].join(', ') + ' e tente de novo.' : 'Confira os dados do cartão e tente de novo.'
}

function currentDeviceId() {
  const value = window.MP_DEVICE_SESSION_ID
  return typeof value === 'string' && /^[A-Za-z0-9._-]{6,512}$/.test(value) ? value : ''
}

// The payment page is served with a per-request CSP nonce on its scripts.
// Browsers hide the attribute value, but the `nonce` property keeps it.
function cspNonce() {
  const value = document.querySelector('script[nonce]')?.nonce
  return typeof value === 'string' && /^[A-Za-z0-9+/_-]{16,128}={0,2}$/.test(value) ? value : ''
}

// Mercado Pago's official device collector sets MP_DEVICE_SESSION_ID, which the
// server sends as X-Meli-Session-Id. It injects an inline script, so it runs
// under CSP only with the payment page nonce. Never invent a replacement ID.
function loadDeviceProfile() {
  if (currentDeviceId() || deviceScript?.isConnected) return
  const existing = [...document.scripts].find(script => script.src === deviceSdkUrl)
  if (existing) { deviceScript = existing; return }
  const script = document.createElement('script')
  const nonce = cspNonce()
  if (nonce) script.nonce = nonce
  script.src = deviceSdkUrl
  script.async = true
  script.defer = true
  script.setAttribute('view', 'checkout')
  script.onerror = () => {
    script.remove()
    if (deviceScript === script) deviceScript = null
  }
  deviceScript = script
  document.head.append(script)
}

function loadCardSdk() {
  if (window.MercadoPago) return Promise.resolve(window.MercadoPago)
  if (sdkPromise) return sdkPromise
  sdkPromise = new Promise((resolve, reject) => {
    const script = document.createElement('script')
    script.src = sdkUrl
    script.async = true
    const timeout = window.setTimeout(() => fail(), 12000)
    function fail() {
      window.clearTimeout(timeout)
      script.remove()
      sdkPromise = null
      reject(new Error('Não foi possível carregar os campos seguros do cartão. Confira a conexão e tente novamente.'))
    }
    script.onerror = fail
    script.onload = () => {
      if (!window.MercadoPago) return fail()
      window.clearTimeout(timeout)
      resolve(window.MercadoPago)
    }
    document.head.append(script)
  })
  return sdkPromise
}

function newAttemptId() {
  if (crypto.randomUUID) return crypto.randomUUID()
  const bytes = crypto.getRandomValues(new Uint8Array(16))
  bytes[6] = (bytes[6] & 15) | 64
  bytes[8] = (bytes[8] & 63) | 128
  const hex = Array.from(bytes, value => value.toString(16).padStart(2, '0')).join('')
  return [hex.slice(0, 8), hex.slice(8, 12), hex.slice(12, 16), hex.slice(16, 20), hex.slice(20)].join('-')
}

function savedAttempt(key) {
  try {
    const value = JSON.parse(sessionStorage.getItem(key))
    return value && /^[a-f\d-]{36}$/i.test(value.id) && ['pix', 'credit_card', 'debit_card'].includes(value.method) ? value : null
  } catch { return null }
}

function paymentStatus(snapshot) {
  const status = String(snapshot?.order?.payment_status || snapshot?.payment?.status || 'PENDING').toUpperCase()
  if (snapshot?.order?.status === 'CANCELLED' && status !== 'REFUNDED') return 'CANCELLED'
  return status
}

function paymentReference(payment) {
  return String(payment?.provider_reference || payment?.reference || '')
}

function safeChallengeUrl(value) {
  try {
    const url = new URL(value)
    const domains = ['mercadopago.com', 'mercadopago.com.br', 'mercadopago.com.ar', 'mercadopago.com.mx', 'mercadopago.com.co', 'mercadopago.com.pe', 'mercadopago.com.uy', 'mercadopago.cl']
    return url.protocol === 'https:' && !url.username && !url.password && domains.some(domain => url.hostname === domain || url.hostname.endsWith('.' + domain)) ? url.href : ''
  } catch { return '' }
}

function buyerAddressPayload(useShippingAddress, form) {
  if (useShippingAddress) return { use_shipping_address: true }
  const address = {
    zip_code: form.postal_code.replace(/\D/g, ''), street_name: form.street.trim(),
    street_number: form.number.trim(), city: form.city.trim(), state: form.state.toUpperCase(),
    ...(form.neighborhood.trim() ? { neighborhood: form.neighborhood.trim() } : {}),
    ...(form.complement.trim() ? { complement: form.complement.trim() } : {})
  }
  if (!/^\d{8}$/.test(address.zip_code) || !address.street_name || !address.street_number || !address.city || !states.includes(address.state)) return null
  return { use_shipping_address: false, billing_address: address }
}

function BuyerAddressFields({ useShipping, changeUseShipping, form, setForm, disabled }) {
  const postalAddress = usePostalCodeAddress(form, setForm)
  return <fieldset className="mp-buyer-address" disabled={disabled}>
    <legend>Endereço do comprador</legend>
    <label className="mp-address-choice"><input type="checkbox" checked={useShipping} onChange={event => changeUseShipping(event.target.checked)} />Endereço do comprador é o mesmo da entrega</label>
    {!useShipping && <div className="mp-buyer-address-fields">
      <label>CEP do comprador<input value={form.postal_code} onChange={event => postalAddress.changePostalCode(event.target.value)} autoComplete="billing postal-code" inputMode="numeric" maxLength={9} aria-describedby="mp-buyer-postal-message" required /></label>
      <p className="mp-payment-note" id="mp-buyer-postal-message" role="status">{postalAddress.message}</p>
      <label>Rua do comprador<input value={form.street} onChange={event => postalAddress.changeAddressField('street', event.target.value)} autoComplete="billing address-line1" maxLength={200} required /></label>
      <div className="mp-field-row">
        <label>Número do comprador<input value={form.number} onChange={event => setForm(current => ({ ...current, number: event.target.value }))} autoComplete="off" maxLength={30} required /></label>
        <label>Complemento do comprador<input value={form.complement} onChange={event => setForm(current => ({ ...current, complement: event.target.value }))} autoComplete="billing address-line2" maxLength={100} /></label>
      </div>
      <label>Bairro do comprador<input value={form.neighborhood} onChange={event => postalAddress.changeAddressField('neighborhood', event.target.value)} autoComplete="billing address-level3" maxLength={100} /></label>
      <div className="mp-field-row">
        <label>Cidade do comprador<input value={form.city} onChange={event => postalAddress.changeAddressField('city', event.target.value)} autoComplete="billing address-level2" maxLength={100} required /></label>
        <label>Estado do comprador<select aria-label="Estado do comprador" value={form.state} onChange={event => postalAddress.changeAddressField('state', event.target.value)} autoComplete="billing address-level1" required><option value="">Selecione</option>{states.map(state => <option key={state} value={state}>{state}</option>)}</select></label>
      </div>
    </div>}
  </fieldset>
}

// Text colors inside the secure fields; their boxes follow the page theme.
const secureFieldColors = {
  dark: { color: '#f2eadb', placeholderColor: '#a59d91' },
  light: { color: '#1a1510', placeholderColor: '#6f665a' }
}

function readDocumentTheme() {
  return document.documentElement.dataset.theme === 'light' ? 'light' : 'dark'
}

function useDocumentTheme() {
  const [theme, setTheme] = useState(readDocumentTheme)
  useEffect(() => {
    const observer = new MutationObserver(() => setTheme(readDocumentTheme()))
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] })
    setTheme(readDocumentTheme())
    return () => observer.disconnect()
  }, [])
  return theme
}

function CardPaymentForm({ publicKey, order, disabled, submit, methods, initialMethod, lockedMethod }) {
  const id = 'galeo-mp-' + useId().replace(/[^\w-]/g, '')
  const cardForm = useRef(null)
  const submitRef = useRef(submit)
  const typeRef = useRef('credit_card')
  submitRef.current = submit
  const [cardType, setCardType] = useState(initialMethod === 'debit_card' ? 'debit_card' : methods.includes('credit_card') ? 'credit_card' : 'debit_card')
  typeRef.current = cardType
  const [mounted, setMounted] = useState(false)
  const [error, setError] = useState('')
  const [retry, setRetry] = useState(0)
  const secureFields = ['cardNumber', 'expirationDate', 'securityCode']
  const theme = useDocumentTheme()
  // CardFormMap.style applies inside Mercado Pago's cross-origin iframes; the
  // application's CSS cannot set the text size or color in those documents, so
  // the fields are mounted again when the theme changes.
  const secureFieldStyle = { fontSize: '16px', fontFamily: 'Roboto, Arial, sans-serif', fontWeight: '400', height: '100%', ...secureFieldColors[theme] }

  useEffect(() => {
    if (lockedMethod === 'credit_card' || lockedMethod === 'debit_card') setCardType(lockedMethod)
  }, [lockedMethod])

  useEffect(() => {
    let disposed = false, mountTimer, controller, formReady = false, attemptedAt = 0
    const form = document.getElementById(id)
    const markAttempt = () => { attemptedAt = Date.now() }
    // Errors right after "Pagar com cartão" are about the data typed by the buyer.
    const showCardError = error => {
      if (disposed || !formReady || Date.now() - attemptedAt > 15000) return
      attemptedAt = 0
      setError(cardDataError(error))
    }
    setMounted(false)
    setError('')
    function failed() {
      if (disposed) return
      setMounted(false)
      setError('Não foi possível abrir os campos seguros do cartão. Tente novamente ou escolha Pix.')
    }
    async function mount() {
      try {
        const MercadoPago = await loadCardSdk()
        if (disposed) return
        // The standalone security.js owns device collection (one session, sent
        // as X-Meli-Session-Id); the SDK's own collector would add a second one.
        const mp = new MercadoPago(publicKey, { locale: 'pt-BR', advancedFraudPrevention: false })
        controller = mp.cardForm({
          amount: Number(order.total).toFixed(2),
          iframe: true,
          form: {
            id,
            cardNumber: { id: id + '-cardNumber', placeholder: 'Número do cartão', style: secureFieldStyle },
            expirationDate: { id: id + '-expirationDate', placeholder: 'MM/AA', style: secureFieldStyle },
            securityCode: { id: id + '-securityCode', placeholder: 'CVV', style: secureFieldStyle },
            cardholderName: { id: id + '-name' },
            issuer: { id: id + '-issuer' },
            installments: { id: id + '-installments' },
            identificationType: { id: id + '-identificationType' },
            identificationNumber: { id: id + '-identificationNumber' },
            cardholderEmail: { id: id + '-email' }
          },
          callbacks: {
            onCardTokenReceived: (error, token) => {
              if (error) showCardError(error)
              return token
            },
            onError: showCardError,
            onFormMounted: error => {
              if (disposed) return
              if (error) return failed()
              requestAnimationFrame(() => {
                if (disposed) return
                const usable = secureFields.every(field => {
                  const host = document.getElementById(id + '-' + field)
                  return host?.querySelectorAll('iframe').length === 1 && host.getBoundingClientRect().height > 0 && host.getBoundingClientRect().width > 0
                })
                if (!usable) return failed()
                formReady = true
                window.clearTimeout(mountTimer)
                setMounted(true)
              })
            },
            onSubmit: event => {
              event.preventDefault()
              if (disposed || !cardForm.current) return
              const data = cardForm.current.getCardFormData()
              if (!data?.token || !data?.paymentMethodId) {
                setError('Confira os dados do cartão antes de continuar.')
                return
              }
              setError('')
              submitRef.current({
                method: typeRef.current,
                token: data.token,
                payment_method_id: data.paymentMethodId,
                installments: 1,
                identification: { type: 'CPF', number: String(data.identificationNumber || '').replace(/\D/g, '') }
              })
            }
          }
        })
        cardForm.current = controller
        form?.addEventListener('submit', markAttempt, true)
        mountTimer = window.setTimeout(() => { if (!disposed && !formReady) failed() }, 8000)
      } catch { failed() }
    }
    mount()
    return () => {
      disposed = true
      window.clearTimeout(mountTimer)
      form?.removeEventListener('submit', markAttempt, true)
      if (cardForm.current === controller) cardForm.current = null
      try { controller?.unmount?.() } catch {}
    }
  }, [publicKey, order.total, id, retry, theme])

  return <form id={id} className="mp-payment-form" onSubmit={event => event.preventDefault()} data-mp-public-key-source="runtime-endpoint" data-mp-payer-email-source="application" data-mp-payer-identification-source="form" data-mp-identification-type="CPF">
    {methods.includes('credit_card') && methods.includes('debit_card') && <fieldset className="mp-card-types"><legend>Tipo de cartão</legend>{[['credit_card', 'Crédito'], ['debit_card', 'Débito']].map(([value, label]) => <label key={value}><input type="radio" name={id + '-type'} value={value} checked={cardType === value} disabled={disabled || Boolean(lockedMethod)} onChange={() => setCardType(value)} />{label}</label>)}</fieldset>}
    <div className="mp-secure-field" role="group" aria-labelledby={id + '-cardNumber-label'}><span id={id + '-cardNumber-label'}>Número do cartão</span><div className="mp-secure-input" id={id + '-cardNumber'} data-mp-secure-field="cardNumber" aria-labelledby={id + '-cardNumber-label'} /></div>
    <div className="mp-field-row">
      <div className="mp-secure-field" role="group" aria-labelledby={id + '-expirationDate-label'}><span id={id + '-expirationDate-label'}>Validade do cartão</span><div className="mp-secure-input" id={id + '-expirationDate'} data-mp-secure-field="expirationDate" aria-labelledby={id + '-expirationDate-label'} /></div>
      <div className="mp-secure-field" role="group" aria-labelledby={id + '-securityCode-label'}><span id={id + '-securityCode-label'}>Código de segurança</span><div className="mp-secure-input" id={id + '-securityCode'} data-mp-secure-field="securityCode" aria-labelledby={id + '-securityCode-label'} /></div>
    </div>
    <label>Nome no cartão<input id={id + '-name'} autoComplete="cc-name" required /></label>
    <label>CPF do titular<input id={id + '-identificationNumber'} inputMode="numeric" autoComplete="off" maxLength={14} required
      onInput={event => { const digits = event.currentTarget.value.replace(/\D/g, '').slice(0, 11); if (digits !== event.currentTarget.value) event.currentTarget.value = digits }} /></label>
    <input id={id + '-email'} type="email" value={order.customer_email || order.email || ''} readOnly hidden />
    <select id={id + '-issuer'} data-mp-sdk-required-field="issuer" hidden aria-hidden="true" tabIndex={-1} />
    <select id={id + '-installments'} data-mp-sdk-required-field="installments" hidden aria-hidden="true" tabIndex={-1} />
    <select id={id + '-identificationType'} data-mp-sdk-required-field="identificationType" hidden aria-hidden="true" tabIndex={-1} />
    <p className="mp-payment-note">Pagamento à vista. Os dados do cartão são preenchidos nos campos seguros do Mercado Pago.</p>
    {!mounted && !error && <p role="status">Carregando campos seguros…</p>}
    {error && <div><p className="form-error" role="alert">{error}</p><button className="button button-ghost" type="button" disabled={disabled} onClick={() => setRetry(value => value + 1)}>Carregar campos novamente</button></div>}
    <button className="button button-primary" type="submit" disabled={disabled || !mounted}>{disabled ? 'Processando pagamento…' : lockedMethod ? 'Retomar pagamento com cartão' : 'Pagar com cartão'}</button>
  </form>
}

export default function MercadoPagoCheckout({ order: initialOrder, onPaid }) {
  usePageMeta('Pagamento')
  const params = useParams()
  const orderId = Number(initialOrder?.id || params.orderId)
  const attemptKey = 'galeo.mp.attempt.' + orderId
  const [snapshot, setSnapshot] = useState(null)
  const [config, setConfig] = useState(null)
  const [loading, setLoading] = useState(true)
  const [loadRevision, setLoadRevision] = useState(0)
  const [error, setError] = useState('')
  const [pollError, setPollError] = useState('')
  const [method, setMethod] = useState('pix')
  const [cpf, setCpf] = useState('')
  const [useShippingAddress, setUseShippingAddress] = useState(true)
  const [buyerAddress, setBuyerAddress] = useState(emptyBuyerAddress)
  const [submitting, setSubmitting] = useState(false)
  const [uncertain, setUncertain] = useState(false)
  const attempt = useRef(savedAttempt(attemptKey))
  const inFlight = useRef(false)
  const pendingBody = useRef(null)
  const lifecycle = useRef(0)
  const paidNotified = useRef(false)
  const paidCallback = useRef(onPaid)
  paidCallback.current = onPaid
  const endpoint = '/api/store/orders/' + orderId + '/payment'
  const status = paymentStatus(snapshot)
  const cancelledOrder = snapshot?.order?.status === 'CANCELLED'
  const terminal = ['APPROVED', 'REFUNDED'].includes(status) || cancelledOrder
  const payment = snapshot?.payment
  const waiting = !terminal && Boolean(paymentReference(payment)) && !['REJECTED', 'CANCELLED', 'REFUNDED'].includes(status) && !['REJECTED', 'CANCELLED', 'REFUNDED'].includes(String(payment?.status).toUpperCase())
  const cardMethods = (config?.methods || []).filter(value => value === 'credit_card' || value === 'debit_card')

  const accept = useCallback(data => {
    setSnapshot(data)
    setPollError('')
    const state = paymentStatus(data)
    if (state === 'APPROVED' && !paidNotified.current) {
      paidNotified.current = true
      paidCallback.current?.(data.order)
    }
    if (['APPROVED', 'REJECTED', 'CANCELLED', 'REFUNDED'].includes(state)) {
      setUncertain(false)
      pendingBody.current = null
      attempt.current = null
      try { sessionStorage.removeItem(attemptKey) } catch {}
    } else if (data.payment?.attempt_id && /^[a-f\d-]{36}$/i.test(data.payment.attempt_id) && ['pix', 'credit_card', 'debit_card'].includes(data.payment.method)) {
      attempt.current = { id: data.payment.attempt_id, method: data.payment.method }
      try { sessionStorage.setItem(attemptKey, JSON.stringify(attempt.current)) } catch {}
      if (data.payment.awaiting_confirmation) setUncertain(true)
    }
  }, [attemptKey])

  useEffect(() => {
    if (config?.available && snapshot && !terminal && !waiting) loadDeviceProfile()
  }, [config?.available, snapshot, terminal, waiting])

  useEffect(() => {
    const current = ++lifecycle.current
    const controller = new AbortController()
    setLoading(true)
    setError('')
    setSnapshot(null)
    setConfig(null)
    setPollError('')
    setUncertain(false)
    setSubmitting(false)
    setUseShippingAddress(true)
    setBuyerAddress(emptyBuyerAddress())
    attempt.current = savedAttempt(attemptKey)
    pendingBody.current = null
    inFlight.current = false
    paidNotified.current = false
    if (!Number.isInteger(orderId) || orderId < 1) {
      setError('Pedido inválido. Acesse o pagamento pelos seus pedidos.')
      setLoading(false)
      return () => controller.abort()
    }
    Promise.all([customerApi('/api/store/payments/config', { signal: controller.signal }), customerApi('/api/customer/me', { signal: controller.signal }), customerApi(endpoint, { signal: controller.signal })])
      .then(([settings, profile, data]) => {
        if (current !== lifecycle.current) return
        if (!profile?.authenticated) throw Object.assign(new Error('Entre na sua conta para acessar o pagamento deste pedido.'), { status: 401 })
        setConfig(settings)
        accept({ ...data, order: { ...data.order, customer_email: data.order?.customer_email || profile.user?.email || '' } })
        const previous = savedAttempt(attemptKey)
        attempt.current = previous
        setMethod(previous?.method === 'pix' ? 'pix' : previous ? 'card' : settings.methods?.includes('pix') ? 'pix' : 'card')
      })
      .catch(error => { if (!controller.signal.aborted && current === lifecycle.current) setError(error?.status === 401 ? 'Entre na sua conta para acessar o pagamento deste pedido.' : error.message || 'Não foi possível carregar o pagamento.') })
      .finally(() => { if (current === lifecycle.current) setLoading(false) })
    return () => { controller.abort(); lifecycle.current += 1 }
  }, [orderId, endpoint, accept, loadRevision])

  useEffect(() => {
    if (!waiting || loading) return
    let disposed = false, timer, controller
    function schedule() { if (!disposed) timer = window.setTimeout(check, 9000) }
    async function check() {
      if (disposed) return
      if (document.hidden || inFlight.current) return schedule()
      controller = new AbortController()
      try {
        const data = await customerApi(endpoint, { signal: controller.signal })
        if (!disposed) accept(data)
      } catch { if (!disposed) setPollError('A confirmação está demorando. Você pode conferir o pagamento novamente.') }
      schedule()
    }
    schedule()
    return () => { disposed = true; window.clearTimeout(timer); controller?.abort() }
  }, [waiting, endpoint, loading, accept])

  async function refresh() {
    if (inFlight.current) return
    const current = lifecycle.current
    setPollError('')
    try {
      const data = await customerApi(endpoint)
      if (current === lifecycle.current) accept(data)
    } catch { if (current === lifecycle.current) setPollError('Não foi possível conferir o pagamento agora. Tente novamente.') }
  }

  async function submit(body) {
    if (inFlight.current || terminal || waiting || !config?.available) return
    const current = lifecycle.current
    let selected = attempt.current
    if (selected && selected.method !== body.method) {
      setError('Confira o pagamento anterior antes de escolher outra forma de pagamento.')
      return
    }
    const address = uncertain && pendingBody.current ? null : buyerAddressPayload(useShippingAddress, buyerAddress)
    if (!(uncertain && pendingBody.current) && !address) {
      setError('Confira o endereço do comprador antes de pagar.')
      return
    }
    if (!selected) {
      selected = { id: newAttemptId(), method: body.method }
      attempt.current = selected
      try { sessionStorage.setItem(attemptKey, JSON.stringify(selected)) } catch {}
    }
    const deviceId = currentDeviceId()
    const requestBody = uncertain && pendingBody.current ? pendingBody.current : {
      ...body, ...address, ...(deviceId ? { device_id: deviceId } : {}), attempt_id: selected.id
    }
    pendingBody.current = requestBody
    inFlight.current = true
    setSubmitting(true)
    setError('')
    try {
      const data = await customerApi(endpoint, { method: 'POST', body: requestBody })
      if (current !== lifecycle.current) return
      setUncertain(false)
      pendingBody.current = null
      accept(data)
    } catch (error) {
      if (current !== lifecycle.current) return
      setUncertain(!error.status || error.status >= 500)
      if (error.status >= 400 && error.status < 500 && error.status !== 409 && error.status !== 429) {
        attempt.current = null
        pendingBody.current = null
        try { sessionStorage.removeItem(attemptKey) } catch {}
      }
      setError(error.message || 'Não foi possível concluir a solicitação. Confira o pagamento antes de tentar novamente.')
    } finally {
      if (current === lifecycle.current) {
        inFlight.current = false
        setSubmitting(false)
      }
    }
  }

  const challengeUrl = safeChallengeUrl(payment?.redirect_url)
  const qrImage = typeof payment?.qr_code_base64 === 'string' && payment.qr_code_base64.length < 200000 && /^[A-Za-z\d+/=\r\n]+$/.test(payment.qr_code_base64) ? 'data:image/png;base64,' + payment.qr_code_base64 : ''
  const expiry = payment?.expires_at && new Date(payment.expires_at)
  const validExpiry = expiry && Number.isFinite(expiry.getTime()) ? expiry.toLocaleString('pt-BR') : ''

  return <main className="section-shell page-space mp-checkout-page">
    <CheckoutSteps current={2} />
    <section className="mp-checkout-card" aria-labelledby="mp-checkout-title">
      <h1 id="mp-checkout-title">Pagamento</h1>
      {(snapshot?.order?.code || initialOrder?.code) && <p className="mp-order-code">Pedido <strong>{snapshot?.order?.code || initialOrder.code}</strong></p>}
      {loading ? <p role="status">Carregando pagamento…</p> : <>
        {snapshot?.order && <div className="mp-checkout-total"><span>Total do pedido</span><strong>{money(snapshot.order.total)}</strong></div>}
        {snapshot?.order && <p className="mp-secure-note"><LockIcon /><span>Pagamento seguro processado pelo Mercado Pago</span></p>}
        {config?.mode === 'test' && <p className="mp-test-notice" role="status">Compra de teste — sem cobrança real.</p>}
        {error && <p className="form-error" role="alert">{error}</p>}
        {!snapshot ? <div className="mp-payment-form"><button className="button button-ghost" type="button" onClick={() => setLoadRevision(value => value + 1)}>Carregar pagamento novamente</button><Link className="button button-ghost" to="/conta">Acessar minha conta</Link></div> : status === 'APPROVED' ? <div role="status"><h2>Pagamento aprovado</h2><p>Seu pedido está confirmado. Você pode acompanhá-lo na sua conta.</p></div> : status === 'REFUNDED' ? <div role="status"><h2>Pagamento estornado</h2><p>Acompanhe o estorno pelo Mercado Pago.</p></div> : cancelledOrder ? <div role="status"><h2>Pedido cancelado</h2><p>Este pedido não pode receber novos pagamentos.</p></div> : !config?.available ? <p role="status">O pagamento online ainda está sendo preparado pela loja. Você pode acompanhar seu pedido na sua conta.</p> : waiting ? <div className="mp-pending-payment">
          <h2>{challengeUrl ? 'Confirme o pagamento' : 'Aguardando pagamento'}</h2>
          {payment?.qr_code && <>
            {qrImage && <img className="mp-pix-qr" src={qrImage} alt="QR Code Pix do pedido" width="240" height="240" />}
            <label>Pix copia e cola<textarea readOnly value={payment.qr_code} rows={4} /></label>
            <button className="button button-ghost" type="button" onClick={async () => { try { await navigator.clipboard.writeText(payment.qr_code); setPollError('Código Pix copiado.') } catch { setPollError('Selecione o código Pix acima e copie para o aplicativo do seu banco.') } }}>Copiar código Pix</button>
            {validExpiry && <p>Válido até {validExpiry}.</p>}
          </>}
          {challengeUrl && <a className="button button-primary" href={challengeUrl} rel="noopener noreferrer">Confirmar no Mercado Pago</a>}
          <p>A confirmação será atualizada automaticamente. Você pode voltar à sua conta e acompanhar o pedido.</p>
          <button className="button button-ghost" type="button" onClick={refresh}>Conferir pagamento</button>
        </div> : <>
          {status === 'REJECTED' && <p className="form-error" role="status">O pagamento não foi aprovado. Confira os dados ou escolha outra forma de pagamento.</p>}
          {status === 'CANCELLED' && <p role="status">A tentativa anterior foi cancelada. Escolha a forma de pagamento para tentar novamente.</p>}
          <BuyerAddressFields useShipping={useShippingAddress} changeUseShipping={setUseShippingAddress} form={buyerAddress} setForm={setBuyerAddress} disabled={submitting || uncertain} />
          <div className="mp-method-tabs" role="group" aria-label="Forma de pagamento">
            {config.methods?.includes('pix') && <button type="button" aria-pressed={method === 'pix'} disabled={submitting || uncertain} onClick={() => setMethod('pix')}><QrIcon />Pix</button>}
            {cardMethods.length > 0 && <button type="button" aria-pressed={method === 'card'} disabled={submitting || uncertain} onClick={() => setMethod('card')}><CardIcon />Cartão</button>}
          </div>
          {method === 'pix' ? <form className="mp-payment-form" onSubmit={event => { event.preventDefault(); submit({ method: 'pix', identification: { type: 'CPF', number: cpf.replace(/\D/g, '') } }) }}>
            <label>CPF do comprador<input value={cpf} onChange={event => setCpf(event.target.value)} inputMode="numeric" autoComplete="off" maxLength={14} required /></label>
            <button className="button button-primary" type="submit" disabled={submitting}>{submitting ? 'Gerando Pix…' : uncertain ? 'Retomar pagamento Pix' : 'Gerar Pix'}</button>
          </form> : <CardPaymentForm publicKey={config.public_key} order={snapshot.order} submit={submit} methods={cardMethods} disabled={submitting} initialMethod={attempt.current?.method} lockedMethod={uncertain ? attempt.current?.method : null} />}
          {uncertain && <div><p>Estamos conferindo a tentativa anterior. Ao tentar novamente, a mesma solicitação será retomada.</p><button className="button button-ghost" type="button" disabled={submitting} onClick={refresh}>Conferir pagamento</button></div>}
        </>}
        {pollError && <p className="mp-payment-note" role="status">{pollError}</p>}
        {snapshot && <Link className="button button-ghost mp-orders-link" to="/conta">Ver meus pedidos</Link>}
      </>}
    </section>
  </main>
}
