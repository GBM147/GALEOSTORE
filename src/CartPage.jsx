import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { customerApi, readCart, writeCart } from './storeApi'

const money = (value) => Number(value || 0).toLocaleString('pt-BR', { style:'currency', currency:'BRL' })

export default function CartPage() {
  const navigate = useNavigate()
  const [cart, setCart] = useState(readCart)
  const [catalog, setCatalog] = useState([])
  const [customer, setCustomer] = useState(null)
  const [form, setForm] = useState({ name:'', phone:'', postal_code:'', street:'', number:'', complement:'', neighborhood:'', city:'', state:'' })
  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')
  const [orderCode, setOrderCode] = useState('')

  useEffect(() => {
    const onCartUpdate = (event) => setCart(Array.isArray(event.detail) ? event.detail : readCart())
    window.addEventListener('galeo-cart-updated', onCartUpdate)
    return () => window.removeEventListener('galeo-cart-updated', onCartUpdate)
  }, [])

  useEffect(() => {
    Promise.all([
      fetch('https://galeo-api-go.onrender.com/api/store?ts=' + Date.now(), { cache:'no-store' }).then((r) => r.ok ? r.json() : null).catch(() => null),
      customerApi('/api/customer/me').catch(() => null)
    ]).then(([store, me]) => {
      setCatalog(Array.isArray(store?.products) ? store.products : [])
      if (me?.authenticated) {
        setCustomer(me.user)
        setForm((current) => ({ ...current, name:me.user.name || '', phone:me.user.phone || '' }))
      }
    }).finally(() => setLoading(false))
  }, [])

  const items = useMemo(() => cart.map((item) => {
    const current = catalog.find((product) => Number(product.id) === Number(item.id))
    return { ...item, current, quantity: Math.max(1, Number(item.quantity || 1)) }
  }).filter((item) => item.current), [cart, catalog])

  const subtotal = items.reduce((sum,item) => sum + Number(item.current.price || 0) * item.quantity, 0)

  function changeQuantity(item, value) {
    const next = Math.max(1, Math.min(Number(item.current?.stock || 1), Number(value || 1)))
    setCart(writeCart(cart.map((entry) => Number(entry.id) === Number(item.id) ? { ...entry, quantity:next } : entry)))
  }

  function removeItem(id) {
    setCart(writeCart(cart.filter((entry) => Number(entry.id) !== Number(id))))
  }

  async function submitOrder(event) {
    event.preventDefault()
    if (!customer) { navigate('/conta?return=/carrinho'); return }
    if (!items.length) return
    setSubmitting(true); setError('')
    try {
      const data = await customerApi('/api/store/orders', {
        method:'POST',
        body:{ items:items.map((item) => ({ product_id:Number(item.id), quantity:item.quantity })), shipping:form }
      })
      writeCart([])
      setOrderCode(data.order?.code || '')
    } catch (err) { setError(err.message) } finally { setSubmitting(false) }
  }

  if (loading) return <main className="section-shell page-space product-page-state"><span className="eyebrow">GALEO / CARRINHO</span><h1>Carregando carrinho</h1></main>
  if (orderCode) return <main className="section-shell page-space cart-success"><span className="eyebrow">GALEO / PEDIDO</span><h1>Pedido recebido</h1><p>Seu pedido <strong>{orderCode}</strong> foi registrado e está aguardando confirmação</p><Link className="button button-primary" to="/conta">Ver meus pedidos ↗</Link></main>

  return (
    <main className="section-shell cart-page page-space">
      <div className="page-heading"><span className="eyebrow">GALEO / CARRINHO</span><h1>Seu carrinho</h1></div>
      {!items.length ? <div className="empty-catalog cart-empty"><h2>Seu carrinho está vazio</h2><p>Adicione uma peça do catálogo para começar seu pedido</p><Link className="button button-primary" to="/shop">Explorar catálogo ↗</Link></div> : (
        <div className="cart-layout">
          <section className="cart-items">{items.map((item) => <article className="cart-item" key={item.id}><Link to={'/produto/' + item.id} className="cart-item-image"><img src={item.current.image || item.image || '/images/product-placeholder.svg'} alt="" /></Link><div className="cart-item-info"><span>{item.current.brand || item.current.category || 'GALEO'}</span><Link to={'/produto/' + item.id}><strong>{item.current.name}</strong></Link><small>{money(item.current.price)}</small><div className="quantity-control"><button type="button" onClick={() => changeQuantity(item,item.quantity-1)}>−</button><span>{item.quantity}</span><button type="button" onClick={() => changeQuantity(item,item.quantity+1)}>+</button></div></div><div className="cart-item-total"><strong>{money(Number(item.current.price || 0) * item.quantity)}</strong><button type="button" onClick={() => removeItem(item.id)}>Remover</button></div></article>)}<button className="text-button" type="button" onClick={() => setCart(writeCart([]))}>Limpar carrinho</button></section>
          <aside className="cart-summary"><div><span>Subtotal</span><strong>{money(subtotal)}</strong></div><div><span>Frete</span><strong>A calcular</strong></div><div className="cart-summary-total"><span>Total do pedido</span><strong>{money(subtotal)}</strong></div>
            {!customer ? <div className="cart-login-box"><span>Para finalizar o pedido</span><strong>Entre ou crie sua conta</strong><Link className="button button-primary" to="/conta?return=/carrinho">Entrar / criar conta ↗</Link></div> : (
              <form className="checkout-form" onSubmit={submitOrder}><span className="eyebrow">ENTREGA</span><label>Nome<input value={form.name} onChange={(e) => setForm((c)=>({...c,name:e.target.value}))} required /></label><label>Telefone<input value={form.phone} onChange={(e) => setForm((c)=>({...c,phone:e.target.value}))} required /></label><div className="checkout-grid"><label>CEP<input value={form.postal_code} onChange={(e) => setForm((c)=>({...c,postal_code:e.target.value}))} required /></label><label>Estado<input value={form.state} onChange={(e) => setForm((c)=>({...c,state:e.target.value.toUpperCase()}))} maxLength="2" required /></label></div><label>Rua<input value={form.street} onChange={(e) => setForm((c)=>({...c,street:e.target.value}))} required /></label><div className="checkout-grid"><label>Número<input value={form.number} onChange={(e) => setForm((c)=>({...c,number:e.target.value}))} required /></label><label>Complemento<input value={form.complement} onChange={(e) => setForm((c)=>({...c,complement:e.target.value}))} /></label></div><label>Bairro<input value={form.neighborhood} onChange={(e) => setForm((c)=>({...c,neighborhood:e.target.value}))} required /></label><label>Cidade<input value={form.city} onChange={(e) => setForm((c)=>({...c,city:e.target.value}))} required /></label>{error && <p className="form-error">{error}</p>}<button className="button button-primary" type="submit" disabled={submitting}>{submitting ? 'Enviando pedido…' : 'Solicitar pedido ↗'}</button></form>
            )}
          </aside>
        </div>
      )}
    </main>
  )
}
