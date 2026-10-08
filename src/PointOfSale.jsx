import { useEffect, useMemo, useRef, useState } from 'react'
import './point-of-sale.css'

const money = (value) => Number(value || 0).toLocaleString('pt-BR', {
  style: 'currency', currency: 'BRL'
})

const paymentMethods = [
  ['PIX', 'Pix'],
  ['CARTAO_CREDITO', 'Cartão de crédito'],
  ['CARTAO_DEBITO', 'Cartão de débito'],
  ['DINHEIRO', 'Dinheiro'],
  ['TRANSFERENCIA', 'Transferência'],
  ['OUTRO', 'Outro']
]

const searchText = (value) => String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()

function readPendingSale(storageKey) {
  try {
    const pending = JSON.parse(window.sessionStorage.getItem(storageKey))
    if (!pending || typeof pending.client_reference !== 'string' || !Array.isArray(pending.items) || !pending.items.length) return null
    if (!pending.items.every((item) => Number.isInteger(item.product_id) && item.product_id > 0 && Number.isInteger(item.quantity) && item.quantity > 0)) return null
    if (!paymentMethods.some(([value]) => value === pending.payment_method)) return null
    return pending
  } catch { return null }
}

const createReference = () => globalThis.crypto.randomUUID()

export default function PointOfSale({ api, onSaleCreated, operatorId = 'session', products: initialProducts = [] }) {
  const storageKey = 'galeo.pdv.pending-sale.' + operatorId
  const [pendingSale] = useState(() => readPendingSale(storageKey))
  const [products, setProducts] = useState(initialProducts)
  const [loadingProducts, setLoadingProducts] = useState(true)
  const [productsError, setProductsError] = useState('')
  const [search, setSearch] = useState('')
  const [items, setItems] = useState(pendingSale?.items || [])
  const [customerName, setCustomerName] = useState(pendingSale?.customer_name || '')
  const [paymentMethod, setPaymentMethod] = useState(pendingSale?.payment_method || '')
  const [confirmationPending, setConfirmationPending] = useState(Boolean(pendingSale))
  const [confirmedTotal, setConfirmedTotal] = useState(pendingSale?.expected_total ?? pendingSale?.total ?? 0)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [receipt, setReceipt] = useState(null)
  const [receiptWarning, setReceiptWarning] = useState('')
  const submitting = useRef(false)
  const clientReference = useRef(pendingSale?.client_reference || createReference())

  function clearPendingSale() {
    try { window.sessionStorage.removeItem(storageKey) } catch {}
  }

  async function loadProducts() {
    setLoadingProducts(true)
    setProductsError('')
    try {
      const data = await api('/api/admin/products')
      if (!Array.isArray(data)) throw new Error('Não foi possível carregar os produtos do caixa.')
      setProducts(data)
    } catch (loadError) {
      setProductsError(loadError.message || 'Não foi possível carregar os produtos do caixa.')
    } finally {
      setLoadingProducts(false)
    }
  }

  useEffect(() => {
    let active = true
    api('/api/admin/products').then((data) => {
      if (!Array.isArray(data)) throw new Error('Não foi possível carregar os produtos do caixa.')
      if (active) setProducts(data)
    }).catch((loadError) => {
      if (active) setProductsError(loadError.message || 'Não foi possível carregar os produtos do caixa.')
    }).finally(() => {
      if (active) setLoadingProducts(false)
    })
    return () => { active = false }
  }, [api])

  const availableProducts = useMemo(() => products.filter((product) => Number(product.active) !== 0), [products])
  const visibleProducts = useMemo(() => {
    const term = searchText(search.trim())
    return availableProducts.filter((product) => searchText([product.name, product.brand, product.category].join(' ')).includes(term))
  }, [availableProducts, search])

  const cartItems = items.map((item) => ({
    ...item,
    product: availableProducts.find((product) => Number(product.id) === item.product_id)
  }))
  const estimatedTotal = cartItems.reduce((sum, item) => sum + Math.round(Number(item.product?.price || 0) * 100) * Number(item.quantity || 0), 0) / 100
  const total = confirmationPending ? confirmedTotal : estimatedTotal
  const invalidItem = cartItems.some((item) => !item.product || !Number.isInteger(Number(item.quantity)) || Number(item.quantity) < 1 || Number(item.quantity) > Number(item.product.stock))
  const blocked = saving || loadingProducts || Boolean(productsError) || confirmationPending

  function addProduct(product) {
    if (blocked) return
    setError('')
    setItems((current) => {
      const existing = current.find((item) => item.product_id === Number(product.id))
      if (existing) {
        return current.map((item) => item === existing ? { ...item, quantity: Math.min(Number(item.quantity || 0) + 1, Number(product.stock)) } : item)
      }
      return [...current, { product_id: Number(product.id), quantity: 1 }]
    })
  }

  function setQuantity(productId, value) {
    if (blocked) return
    setError('')
    setItems((current) => current.map((item) => item.product_id === productId ? { ...item, quantity: value === '' ? '' : Number(value) } : item))
  }

  async function submit(event) {
    event.preventDefault()
    if (submitting.current || receipt || saving || loadingProducts || productsError) return
    if (!items.length || (!confirmationPending && invalidItem) || !paymentMethod) {
      setError('Confira os produtos, as quantidades disponíveis e a forma de pagamento.')
      return
    }
    submitting.current = true
    setSaving(true)
    setError('')
    setReceiptWarning('')
    const payload = {
      client_reference: clientReference.current,
      customer_name: customerName.trim(),
      payment_method: paymentMethod,
      expected_total: total,
      items: items.map((item) => ({ product_id: item.product_id, quantity: Number(item.quantity) }))
    }
    try { window.sessionStorage.setItem(storageKey, JSON.stringify({ ...payload, total })) } catch {}
    setConfirmedTotal(total)
    let sale
    try {
      sale = await api('/api/admin/sales', {
        method: 'POST',
        body: payload
      })
      if (!sale?.id || !sale?.code) throw new Error('O servidor não retornou a confirmação da venda.')
    } catch (saleError) {
      const uncertain = !saleError.status || saleError.status >= 500
      setConfirmationPending(uncertain)
      if (!uncertain) clearPendingSale()
      setError((saleError.message || 'Não foi possível registrar a venda.') + (uncertain ? ' Verifique o registro abaixo ou confira a lista de Vendas antes de iniciar outra venda.' : ''))
      if (saleError.status === 409) await loadProducts()
      setSaving(false)
      submitting.current = false
      return
    }

    // Keep the successful sale visible even when a subsequent refresh fails.
    setReceipt(sale)
    setConfirmationPending(false)
    clearPendingSale()
    setItems([])
    const results = await Promise.allSettled([
      api('/api/admin/sales/' + sale.id),
      loadProducts(),
      Promise.resolve().then(() => onSaleCreated?.(sale))
    ])
    if (results[0].status === 'fulfilled') setReceipt(results[0].value)
    else setReceiptWarning('A venda foi registrada. Os itens do comprovante não puderam ser carregados; consulte a venda ' + sale.code + ' em Vendas.')
    if (results[2].status === 'rejected') {
      setReceiptWarning((current) => [current, 'A venda foi registrada, mas o painel não pôde ser atualizado.'].filter(Boolean).join(' '))
    }
    setSaving(false)
    submitting.current = false
  }

  function newSale() {
    if (saving) return
    setReceipt(null)
    setReceiptWarning('')
    setError('')
    setCustomerName('')
    setPaymentMethod('')
    setSearch('')
    clientReference.current = createReference()
    if (productsError) loadProducts()
  }

  if (receipt) {
    const cancelled = receipt.status === 'CANCELADA'
    return (
      <section className="pdv pdv-receipt" aria-labelledby="pdv-receipt-title">
        <div className="pdv-receipt-heading" role="status">
          <span className="eyebrow">LOJA FÍSICA / {cancelled ? 'VENDA CANCELADA' : 'VENDA REGISTRADA'}</span>
          <h2 id="pdv-receipt-title">{cancelled ? 'Venda cancelada: ' : 'Venda '}{receipt.code}</h2>
          <p>{cancelled ? 'Esta venda foi cancelada. Estoque estornado e lançamento financeiro cancelado.' : 'Pagamento confirmado pelo operador. Estoque e financeiro atualizados.'}</p>
        </div>
        <dl className="pdv-receipt-details">
          <div><dt>Cliente</dt><dd>{receipt.customer_name || 'Não informado'}</dd></div>
          <div><dt>Pagamento</dt><dd>{paymentMethods.find(([value]) => value === receipt.payment_method)?.[1] || receipt.payment_method}</dd></div>
        </dl>
        {Array.isArray(receipt.items) && (
          <ul className="pdv-receipt-items">
            {receipt.items.map((item) => (
              <li key={item.id || item.product_id}>
                <div><strong>{item.product}</strong><span>{item.quantity} × {money(item.unit_price)}</span></div>
                <strong>{money(item.line_total)}</strong>
              </li>
            ))}
          </ul>
        )}
        <div className="pdv-total"><span>{cancelled ? 'Total da venda' : 'Total pago'}</span><strong>{money(receipt.total)}</strong></div>
        {receiptWarning && <p className="pdv-notice" role="status">{receiptWarning}</p>}
        {productsError && <p className="pdv-error" role="alert">{productsError} O estoque será consultado novamente ao iniciar uma nova venda.</p>}
        <button type="button" className="button button-primary" disabled={saving} onClick={newSale}>{saving ? 'Atualizando…' : 'Iniciar nova venda'}</button>
      </section>
    )
  }

  return (
    <section className="pdv" aria-labelledby="pdv-title">
      <div className="pdv-heading">
        <h2 id="pdv-title">Caixa da loja</h2>
        <p>Selecione os produtos, receba o pagamento e registre a venda.</p>
      </div>
      <div className="pdv-layout">
        <section className="pdv-panel pdv-catalog" aria-labelledby="pdv-products-title">
          <h3 id="pdv-products-title">1. Produtos</h3>
          <label className="pdv-search">Buscar produto<input type="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Nome, marca ou categoria" disabled={saving} /></label>
          {loadingProducts && <p className="pdv-empty" role="status">Carregando estoque…</p>}
          {productsError && <div className="pdv-error" role="alert"><p>{productsError}</p><button type="button" className="pdv-secondary" onClick={loadProducts}>Tentar novamente</button></div>}
          {!loadingProducts && !productsError && (
            <>
              <p className="pdv-count">{visibleProducts.length} {visibleProducts.length === 1 ? 'produto encontrado' : 'produtos encontrados'}</p>
              <ul className="pdv-products">
                {visibleProducts.map((product) => {
                  const selected = items.find((item) => item.product_id === Number(product.id))
                  const available = Number(product.stock)
                  const atLimit = Number(selected?.quantity || 0) >= available
                  return (
                    <li key={product.id}>
                      <button type="button" className="pdv-product" onClick={() => addProduct(product)} disabled={saving || available < 1 || atLimit} aria-label={'Adicionar ' + product.name + ' à venda'}>
                        <span className="pdv-product-name"><strong>{product.name}</strong><small>{[product.brand, product.category].filter(Boolean).join(' · ')}</small></span>
                        <span className="pdv-product-price"><strong>{money(product.price)}</strong><small>{available > 0 ? available + ' em estoque' : 'Sem estoque'}{selected ? ' · ' + (selected.quantity || 0) + ' na venda' : ''}</small></span>
                        <span className="pdv-add" aria-hidden="true">+</span>
                      </button>
                    </li>
                  )
                })}
              </ul>
              {!visibleProducts.length && <p className="pdv-empty">{search.trim() ? 'Nenhum produto corresponde à busca.' : 'Cadastre produtos ativos para começar a vender.'}</p>}
            </>
          )}
        </section>

        <form className="pdv-panel pdv-checkout" onSubmit={submit}>
          <h3>2. Conferir venda</h3>
          {!items.length && <p className="pdv-empty">Adicione os produtos usando a lista ao lado.</p>}
          <ul className="pdv-cart-items">
            {cartItems.map((item) => (
              <li key={item.product_id}>
                <div className="pdv-cart-line"><strong>{item.product?.name || 'Produto indisponível'}</strong><button type="button" className="pdv-remove" disabled={blocked} onClick={() => setItems((current) => current.filter((line) => line.product_id !== item.product_id))} aria-label={'Remover ' + (item.product?.name || 'produto')}>Remover</button></div>
                <div className="pdv-cart-line">
                  <div className="pdv-quantity">
                    <button type="button" disabled={blocked || Number(item.quantity) <= 1} onClick={() => setQuantity(item.product_id, Number(item.quantity) - 1)} aria-label={'Diminuir quantidade de ' + item.product?.name}>−</button>
                    <input type="number" min="1" max={item.product?.stock || 0} step="1" required value={item.quantity} disabled={blocked} onChange={(event) => setQuantity(item.product_id, event.target.value)} aria-label={'Quantidade de ' + item.product?.name} />
                    <button type="button" disabled={blocked || !item.product || Number(item.quantity) >= Number(item.product.stock)} onClick={() => setQuantity(item.product_id, Number(item.quantity || 0) + 1)} aria-label={'Aumentar quantidade de ' + item.product?.name}>+</button>
                  </div>
                  <strong>{money(Math.round(Number(item.product?.price || 0) * 100) * Number(item.quantity || 0) / 100)}</strong>
                </div>
                <small className="pdv-unit-price">{money(item.product?.price)} por unidade</small>
                {!confirmationPending && (!item.product || Number(item.quantity) > Number(item.product.stock)) && <p className="pdv-error">{item.product ? 'Disponível: ' + item.product.stock + ' unidades. Ajuste a quantidade.' : 'Remova este produto da venda.'}</p>}
              </li>
            ))}
          </ul>
          <div className="pdv-total"><span>Total</span><strong>{money(total)}</strong></div>
          <label>Cliente <span className="pdv-optional">(opcional)</span><input value={customerName} onChange={(event) => setCustomerName(event.target.value)} maxLength="180" placeholder="Nome do cliente" disabled={blocked} /></label>
          <label>3. Forma de pagamento<select value={paymentMethod} onChange={(event) => setPaymentMethod(event.target.value)} required disabled={blocked}><option value="">Selecione como o cliente pagou</option>{paymentMethods.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
          <p className="pdv-notice">Receba e confira o pagamento na maquininha, no banco ou em dinheiro antes de confirmar. A confirmação abaixo registra o pagamento recebido.</p>
          {confirmationPending && <p className="pdv-notice" role="status">Há uma confirmação anterior a verificar. Os produtos e o pagamento foram preservados. Ao verificar, uma venda já registrada será recuperada sem criar outra venda.</p>}
          {error && <p className="pdv-error" role="alert">{error}</p>}
          <button type="submit" className="button button-primary pdv-submit" disabled={saving || loadingProducts || Boolean(productsError) || !items.length || (!confirmationPending && invalidItem) || !paymentMethod}>{saving ? 'Registrando venda…' : confirmationPending ? 'Verificar registro da venda' : 'Confirmar pagamento e registrar venda'}</button>
        </form>
      </div>
    </section>
  )
}
