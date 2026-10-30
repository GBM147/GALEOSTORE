import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { customerApi, readCart, STORE_API_BASE, writeCart } from './storeApi'
import { formatProductPrice, productHasPrice } from './productAvailability'
import { cartLineKey, findProductVariant, productForVariant, productHasVariants } from './productVariants'
import ShippingServiceIdentity, { ShippingProviderAttribution } from './ShippingServiceIdentity'
import './product-variants.css'
import './shipping.css'

const money = (value) => Number(value || 0).toLocaleString('pt-BR', { style:'currency', currency:'BRL' })

function pendingOrderFromUrl(search = window.location.search) {
  const params = new URLSearchParams(search)
  const id = Number(params.get('pedido_pendente'))
  return Number.isInteger(id) && id > 0
    ? { id, code:params.get('codigo') || '', paymentConfigured:params.get('pagar') === '1' }
    : null
}

export default function CartPage() {
  const navigate = useNavigate()
  const location = useLocation()
  const [cart, setCart] = useState(readCart)
  const [catalog, setCatalog] = useState([])
  const [customer, setCustomer] = useState(null)
  const [form, setForm] = useState({ name:'', phone:'', postal_code:'', street:'', number:'', complement:'', neighborhood:'', city:'', state:'' })
  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')
  const [catalogError, setCatalogError] = useState('')
  const [registeredOrder, setRegisteredOrder] = useState(pendingOrderFromUrl)
  const submittingRef = useRef(false)
  const [shippingConfig, setShippingConfig] = useState(null)
  const [shippingConfigError, setShippingConfigError] = useState('')
  const [quoteResult, setQuoteResult] = useState(null)
  const [selectedQuoteToken, setSelectedQuoteToken] = useState('')
  const [quotesLoading, setQuotesLoading] = useState(false)
  const [shippingError, setShippingError] = useState('')
  const quoteRequestRef = useRef(0)
  const quoteKeyRef = useRef('')

  useEffect(() => {
    const pending = pendingOrderFromUrl(location.search)
    setRegisteredOrder((current) => current?.id === pending?.id ? current : pending)
    if (!pending) setError('')
  }, [location.search])

  useEffect(() => {
    const onCartUpdate = (event) => setCart(Array.isArray(event.detail) ? event.detail : readCart())
    window.addEventListener('galeo-cart-updated', onCartUpdate)
    return () => window.removeEventListener('galeo-cart-updated', onCartUpdate)
  }, [])

  useEffect(() => {
    Promise.all([
      fetch(STORE_API_BASE + '/api/store?ts=' + Date.now(), { cache:'no-store', headers:{ Accept:'application/json' } })
        .then((response) => {
          if (!response.ok) throw new Error('Não foi possível conferir os produtos do carrinho agora.')
          return response.json()
        })
        .catch(() => { setCatalogError('Não foi possível conferir os produtos do carrinho agora. Tente novamente em instantes.'); return null }),
      customerApi('/api/customer/me').catch(() => null),
      customerApi('/api/store/shipping/config').then((config) => {
        if (typeof config?.configured !== 'boolean' || typeof config?.available !== 'boolean') throw new Error('Invalid shipping configuration')
        setShippingConfig(config)
      }).catch(() => setShippingConfigError('Não foi possível conferir o frete agora. Atualize a página para tentar novamente.'))
    ]).then(([store, me]) => {
      setCatalog(Array.isArray(store?.products) ? store.products : [])
      if (me?.authenticated) {
        setCustomer(me.user)
        setForm((current) => ({ ...current, name:me.user.name || '', phone:me.user.phone || '' }))
      }
    }).finally(() => setLoading(false))
  }, [])

  const items = useMemo(() => cart.map((item) => {
    const product = catalog.find((product) => Number(product.id) === Number(item.id))
    if (!product) return { ...item, current: null }
    const variant = findProductVariant(product, item.variant_id)
    return { ...item, current: productForVariant(product, item.variant_id), missingVariant: productHasVariants(product) && !variant, size_label: variant?.size || item.size_label || '', quantity: Math.max(1, Number(item.quantity || 1)) }
  }).filter((item) => item.current), [cart, catalog])

  const subtotal = items.reduce((sum,item) => sum + Number(item.current.price || 0) * item.quantity, 0)
  const pricePending = items.some((item) => !productHasPrice(item.current))
  const availabilityError = items.some(item => item.missingVariant)
    ? 'Escolha novamente o tamanho na página da peça e remova a versão antiga do carrinho.'
    : pricePending
    ? 'O preço de uma peça do seu carrinho ainda não foi definido. Remova essa peça para continuar.'
    : items.some((item) => item.quantity > Number(item.current.stock || 0))
      ? 'Uma peça do seu carrinho está sem estoque suficiente. Ajuste a quantidade ou remova essa peça para continuar.'
      : ''

  const quoteItems = items.map((item) => ({ product_id:Number(item.id), ...(item.variant_id ? { variant_id:Number(item.variant_id) } : {}), quantity:item.quantity }))
  const postalCode = form.postal_code.replace(/\D/g, '')
  const quoteKey = JSON.stringify([postalCode, items.map((item) => [item.id, item.variant_id || null, item.quantity, Number(item.current.price)])])
  quoteKeyRef.current = quoteKey
  const currentQuoteResult = quoteResult?.key === quoteKey && quoteResult.expiresAt > Date.now() ? quoteResult : null
  const selectedQuote = currentQuoteResult?.quotes.find((quote) => quote.token === selectedQuoteToken) || null
  const shippingBlocked = shippingConfigError || !shippingConfig
    ? 'O frete precisa ser conferido antes de enviar o pedido.'
    : shippingConfig.configured && !shippingConfig.available
      ? 'A entrega ainda está sendo preparada pela loja. Tente novamente mais tarde.'
      : shippingConfig.configured && !selectedQuote
        ? 'Calcule o frete e escolha uma opção de entrega para continuar.'
        : ''

  // A response belongs to the exact cart and destination used to request it.
  // Deriving currentQuoteResult above also invalidates a selection before this
  // effect runs, so an old price cannot be submitted during a cart update.
  useEffect(() => {
    quoteRequestRef.current += 1
    setQuoteResult(null)
    setSelectedQuoteToken('')
    setShippingError('')
    setQuotesLoading(false)
  }, [quoteKey])

  useEffect(() => {
    if (!quoteResult) return
    const timeout = window.setTimeout(() => {
      quoteRequestRef.current += 1
      setQuoteResult(null)
      setSelectedQuoteToken('')
      setShippingError('A cotação expirou. Calcule o frete novamente para continuar.')
    }, Math.max(0, Math.min(quoteResult.expiresAt - Date.now(), 2147483647)))
    return () => window.clearTimeout(timeout)
  }, [quoteResult])

  useEffect(() => () => { quoteRequestRef.current += 1 }, [])

  async function calculateShipping() {
    if (!shippingConfig?.available || availabilityError || !items.length) return
    if (!/^\d{8}$/.test(postalCode)) { setShippingError('Informe um CEP com 8 números.'); return }
    const requestId = ++quoteRequestRef.current
    const requestKey = quoteKey
    setQuotesLoading(true)
    setShippingError('')
    setQuoteResult(null)
    setSelectedQuoteToken('')
    try {
      const result = await customerApi('/api/store/shipping/quotes', { method:'POST', body:{ postal_code:postalCode, items:quoteItems } })
      if (requestId !== quoteRequestRef.current || requestKey !== quoteKeyRef.current) return
      const expiresAt = typeof result?.expires_at === 'number' ? result.expires_at : Date.parse(result?.expires_at || '')
      const quotes = Array.isArray(result?.quotes) ? result.quotes.filter((quote) => typeof quote?.token === 'string' && quote.token && typeof quote.name === 'string' && ['number', 'string'].includes(typeof quote.price) && String(quote.price).trim() !== '' && Number.isFinite(Number(quote.price)) && Number(quote.price) >= 0) : []
      if (!quotes.length) throw new Error('Nenhuma opção de entrega está disponível para este CEP. Confira o CEP ou entre em contato com a loja.')
      if (!Number.isFinite(expiresAt) || expiresAt <= Date.now()) throw new Error('A cotação expirou. Calcule o frete novamente para continuar.')
      setQuoteResult({ key:requestKey, expiresAt, quotes })
    } catch (err) {
      if (requestId === quoteRequestRef.current && requestKey === quoteKeyRef.current) setShippingError(err.message || 'Não foi possível calcular o frete. Tente novamente.')
    } finally {
      if (requestId === quoteRequestRef.current) setQuotesLoading(false)
    }
  }

  function changeQuantity(item, value) {
    const next = Math.max(1, Math.min(Number(item.current?.stock || 1), Number(value || 1)))
    setCart(writeCart(cart.map((entry) => cartLineKey(entry) === cartLineKey(item) ? { ...entry, quantity:next } : entry)))
  }

  function removeItem(item) {
    setCart(writeCart(cart.filter((entry) => cartLineKey(entry) !== cartLineKey(item))))
  }

  async function startPayment(order) {
    if (!order.paymentConfigured) return
    const payment = await customerApi('/api/store/orders/' + order.id + '/payment', { method:'POST' })
    if (payment.checkout_url) {
      window.location.assign(payment.checkout_url)
      return
    }
    if (payment.paid || payment.payment_configured === false) {
      setRegisteredOrder((current) => ({ ...current, paymentConfigured:false, paid:Boolean(payment.paid) }))
      return
    }
    throw new Error('Não foi possível abrir o pagamento. Tente novamente para este pedido.')
  }

  async function retryPayment() {
    if (submittingRef.current || !registeredOrder) return
    if (!customer) {
      navigate('/conta?return=' + encodeURIComponent(window.location.pathname + window.location.search))
      return
    }
    submittingRef.current = true
    setSubmitting(true); setError('')
    try { await startPayment(registeredOrder) }
    catch (err) { setError(err.message) }
    finally { submittingRef.current = false; setSubmitting(false) }
  }

  async function submitOrder(event) {
    event.preventDefault()
    if (submittingRef.current) return
    if (!customer) { navigate('/conta?return=/carrinho'); return }
    if (registeredOrder) { await retryPayment(); return }
    if (!items.length) return
    if (availabilityError) { setError(availabilityError); return }
    if (shippingBlocked) { setError(shippingBlocked); return }
    submittingRef.current = true
    setSubmitting(true); setError('')
    try {
      const data = await customerApi('/api/store/orders', {
        method:'POST',
        body:{ items:quoteItems, shipping:form, ...(selectedQuote ? { shipping_quote:selectedQuote.token } : {}) }
      })
      const order = { id:Number(data.order?.id || 0), code:data.order?.code || '', paymentConfigured:Boolean(data.payment_configured) }
      if (!Number.isInteger(order.id) || order.id <= 0) throw new Error('O servidor não confirmou o registro do pedido.')
      setRegisteredOrder(order)
      const params = new URLSearchParams({ pedido_pendente:String(order.id), codigo:order.code })
      if (order.paymentConfigured) params.set('pagar','1')
      navigate('/carrinho?' + params.toString(), { replace:true })
      writeCart([])
      await startPayment(order)
    } catch (err) { setError(err.message) } finally { submittingRef.current = false; setSubmitting(false) }
  }

  if (loading) return <main className="section-shell page-space product-page-state"><h1>Carregando carrinho</h1></main>
  const paymentQuery = new URLSearchParams(window.location.search).get('pagamento')
  const returnedOrder = new URLSearchParams(window.location.search).get('pedido')
  if (paymentQuery) { const labels = { sucesso:'Pagamento enviado com sucesso', pendente:'Pagamento aguardando confirmação', falha:'Pagamento não concluído' }; return <main className="section-shell page-space cart-success"><h1>{labels[paymentQuery] || 'Pagamento'}</h1>{returnedOrder && <p>Pedido <strong>{returnedOrder}</strong> — o status será atualizado automaticamente quando o Mercado Pago confirmar o pagamento</p>}<Link className="button button-primary" to="/conta">Acompanhar pedido ↗</Link></main> }
  if (registeredOrder) return <main className="section-shell page-space cart-success"><h1>Pedido recebido</h1><p>Seu pedido{registeredOrder.code && <> <strong>{registeredOrder.code}</strong></>} foi registrado. {registeredOrder.paid ? 'Pagamento aprovado.' : 'Acompanhe a confirmação na sua conta.'}</p>{error && <p className="form-error" role="alert">{error}</p>}{registeredOrder.paymentConfigured && <button className="button button-primary" type="button" onClick={retryPayment} disabled={submitting}>{submitting ? 'Abrindo pagamento…' : 'Continuar para pagamento ↗'}</button>}<Link className="button button-ghost" to="/conta">Ver meus pedidos ↗</Link></main>

  return (
    <main className="section-shell cart-page page-space">
      <div className="page-heading"><h1>Seu carrinho</h1></div>
      {catalogError ? <div className="empty-catalog cart-empty" role="alert"><h2>Não foi possível carregar o carrinho</h2><p>{catalogError}</p><button className="button button-primary" type="button" onClick={() => window.location.reload()}>Tentar novamente ↗</button></div> : !items.length ? <div className="empty-catalog cart-empty"><h2>Seu carrinho está vazio</h2><p>Adicione uma peça do catálogo para começar seu pedido</p><Link className="button button-primary" to="/shop">Explorar catálogo ↗</Link></div> : (
        <div className="cart-layout">
          <section className="cart-items">{items.map((item) => <article className="cart-item" key={cartLineKey(item)}><Link to={'/produto/' + item.id} className="cart-item-image"><img src={item.current.image || item.image || '/images/product-placeholder.svg'} alt="" /></Link><div className="cart-item-info"><span>{item.current.brand || item.current.category || 'GALEO'}</span><Link to={'/produto/' + item.id}><strong>{item.current.name}</strong></Link><small>{formatProductPrice(item.current.price)}</small>{item.size_label && <span className="cart-item-size">Tamanho: {item.size_label}</span>}<div className="quantity-control"><button type="button" onClick={() => changeQuantity(item,item.quantity-1)}>−</button><span>{item.quantity}</span><button type="button" onClick={() => changeQuantity(item,item.quantity+1)}>+</button></div></div><div className="cart-item-total"><strong>{productHasPrice(item.current) ? money(Number(item.current.price) * item.quantity) : 'Preço a definir'}</strong><button type="button" onClick={() => removeItem(item)}>Remover</button></div></article>)}<button className="text-button" type="button" onClick={() => setCart(writeCart([]))}>Limpar carrinho</button></section>
          <aside className="cart-summary"><div><span>Subtotal</span><strong>{pricePending ? 'Preço a definir' : money(subtotal)}</strong></div><div><span>Frete</span><strong>{selectedQuote ? money(selectedQuote.price) : shippingConfigError ? 'Indisponível' : shippingConfig?.configured ? 'A calcular' : shippingConfig ? 'A combinar' : 'Conferindo…'}</strong></div><div className="cart-summary-total"><span>{selectedQuote ? 'Total do pedido' : 'Subtotal sem frete'}</span><strong>{pricePending ? 'Preço a definir' : money(subtotal + (selectedQuote ? Number(selectedQuote.price) : 0))}</strong></div>
            <section className="cart-shipping" aria-labelledby="cart-shipping-title">
              <h2 id="cart-shipping-title">Entrega</h2>
              <label className="shipping-postal-label" htmlFor="shipping-postal-code">CEP</label>
              <div className="shipping-postal-row"><input id="shipping-postal-code" form="cart-checkout-form" required autoComplete="shipping postal-code" inputMode="numeric" maxLength={9} value={form.postal_code} onChange={(e) => setForm((current) => ({ ...current, postal_code:e.target.value.replace(/[^\d-]/g, '').slice(0, 9) }))} placeholder="00000-000" />{shippingConfig?.available && <button className="button button-ghost" type="button" disabled={quotesLoading || Boolean(availabilityError)} onClick={calculateShipping}>{quotesLoading ? 'Calculando…' : 'Calcular frete'}</button>}</div>
              {shippingConfigError ? <p className="form-error" role="alert">{shippingConfigError}</p> : !shippingConfig ? <p role="status">Conferindo as opções de entrega…</p> : !shippingConfig.configured ? <p>O frete será combinado com a loja e não está incluído no subtotal.</p> : !shippingConfig.available ? <p role="status">A entrega ainda está sendo preparada pela loja. Tente novamente mais tarde.</p> : <p>Informe seu CEP para consultar valores e prazos de entrega.</p>}
              {shippingError && <p className="form-error" role="alert">{shippingError}</p>}
              {currentQuoteResult && <>
                <fieldset className="shipping-options"><legend>Escolha a entrega</legend>{currentQuoteResult.quotes.map((quote) => <label className="shipping-option" key={quote.token}><input type="radio" name="shipping-service" value={quote.token} checked={selectedQuoteToken === quote.token} onChange={() => { setSelectedQuoteToken(quote.token); setError('') }} /><ShippingServiceIdentity service={quote}><small>{quote.delivery_days !== null && quote.delivery_days !== '' && Number.isFinite(Number(quote.delivery_days)) ? 'Até ' + Number(quote.delivery_days) + (Number(quote.delivery_days) === 1 ? ' dia útil' : ' dias úteis') : 'Prazo informado pela transportadora'}</small></ShippingServiceIdentity><strong className="shipping-option-price">{money(quote.price)}</strong></label>)}</fieldset>
                <ShippingProviderAttribution />
              </>}
            </section>
            {availabilityError ? <p className="form-error" role="alert">{availabilityError}</p> : !customer ? <div className="cart-login-box"><span>Para finalizar o pedido</span><strong>Entre ou crie sua conta</strong><Link className="button button-primary" to="/conta?return=/carrinho">Entrar / criar conta ↗</Link></div> : (
              <form id="cart-checkout-form" className="checkout-form" onSubmit={submitOrder}><h2 className="checkout-title">Endereço de entrega</h2><label>Nome<input value={form.name} onChange={(e) => setForm((c)=>({...c,name:e.target.value}))} required /></label><label>Telefone<input value={form.phone} onChange={(e) => setForm((c)=>({...c,phone:e.target.value}))} required /></label><label>Estado<input value={form.state} onChange={(e) => setForm((c)=>({...c,state:e.target.value.toUpperCase()}))} maxLength="2" required /></label><label>Rua<input value={form.street} onChange={(e) => setForm((c)=>({...c,street:e.target.value}))} required /></label><div className="checkout-grid"><label>Número<input value={form.number} onChange={(e) => setForm((c)=>({...c,number:e.target.value}))} required /></label><label>Complemento<input value={form.complement} onChange={(e) => setForm((c)=>({...c,complement:e.target.value}))} /></label></div><label>Bairro<input value={form.neighborhood} onChange={(e) => setForm((c)=>({...c,neighborhood:e.target.value}))} required /></label><label>Cidade<input value={form.city} onChange={(e) => setForm((c)=>({...c,city:e.target.value}))} required /></label>{error && <p className="form-error">{error}</p>}<button className="button button-primary" type="submit" disabled={submitting || Boolean(shippingBlocked)}>{submitting ? 'Enviando pedido…' : 'Solicitar pedido ↗'}</button></form>
            )}
          </aside>
        </div>
      )}
    </main>
  )
}
