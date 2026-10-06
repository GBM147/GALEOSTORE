import { useEffect, useMemo, useState } from 'react'

const api = async (path, options = {}) => {
  const headers = new Headers(options.headers || {})
  if (options.body && typeof options.body !== 'string') {
    headers.set('Content-Type', 'application/json')
    options = { ...options, body: JSON.stringify(options.body) }
  }

  const response = await fetch(path, {
    ...options,
    headers,
    credentials: 'include'
  })

  const raw = await response.text()
  let data = null
  try { data = raw ? JSON.parse(raw) : null } catch {}

  if (!response.ok) {
    throw new Error(data?.error || 'Erro na comunicação com o servidor.')
  }
  return data
}

const money = (v) => Number(v || 0).toLocaleString('pt-BR', {
  style: 'currency',
  currency: 'BRL'
})

const dateBR = (v) => {
  if (!v) return '—'
  const value = String(v).slice(0, 10)
  const [y, m, d] = value.split('-')
  return y && m && d ? d + '/' + m + '/' + y : String(v)
}


const uploadMedia = async (productId, files, onProgress) => {
  const batchSize = 8
  const results = []

  for (let start = 0; start < files.length; start += batchSize) {
    const batch = files.slice(start, start + batchSize)
    const formData = new FormData()
    for (const file of batch) formData.append('media', file)

    const response = await fetch('/api/admin/products/' + productId + '/media', {
      method: 'POST',
      body: formData,
      credentials: 'include'
    })
    const raw = await response.text()
    let data = null
    try { data = raw ? JSON.parse(raw) : null } catch {}
    if (!response.ok) throw new Error(data?.error || 'Não foi possível enviar a mídia.')

    if (Array.isArray(data?.media)) results.push(...data.media)
    onProgress?.(Math.min(start + batch.length, files.length), files.length)
  }

  return { success: true, media: results }
}

const emptyProduct = {
  name: '',
  brand: '',
  category_id: '',
  description: '',
  price: '',
  cost: '',
  stock: 0,
  min_stock: 0,
  image: '',
  video: '',
  active: true
}

function Login({ onLogin }) {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [manterConectado, setManterConectado] = useState(false)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  async function submit(event) {
    event.preventDefault()
    setError('')
    setLoading(true)
    try {
      const data = await api('/api/auth/login', {
        method: 'POST',
        body: { email, password, manterConectado }
      })
      if (!data?.success) throw new Error('Não foi possível iniciar a sessão.')
      onLogin(data.user)
    } catch (err) {
      setError(err?.message || 'Não foi possível entrar no painel.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <main className="admin-login">
      <form onSubmit={submit}>
        <span className="eyebrow">GALEO / ADMIN</span>
        <h1>Painel administrativo.</h1>
        <input placeholder="E-mail" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
        <input placeholder="Senha" type="password" value={password} onChange={(e) => setPassword(e.target.value)} required />
        <label className="admin-check">
          <input type="checkbox" checked={manterConectado} onChange={(e) => setManterConectado(e.target.checked)} />
          Manter conectado
        </label>
        <button className="button button-primary" disabled={loading}>
          {loading ? 'Entrando…' : 'Entrar ↗'}
        </button>
        {error && <p className="admin-error">{error}</p>}
      </form>
    </main>
  )
}

function ProductForm({ product, categories, onClose, onDone }) {
  const editing = Boolean(product?.id)
  const [form, setForm] = useState(product ? {
    ...product,
    category_id: product.category_id || '',
    active: Boolean(product.active)
  } : emptyProduct)
  const [media, setMedia] = useState([])
  const [imageFiles, setImageFiles] = useState([])
  const [videoFiles, setVideoFiles] = useState([])
  const [uploadProgress, setUploadProgress] = useState({ done: 0, total: 0 })
  const [saving, setSaving] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [mediaError, setMediaError] = useState('')
  const set = (key, value) => setForm((current) => ({ ...current, [key]: value }))

  function appendFiles(setter, incomingFiles) {
    setter((current) => {
      const existing = new Set(
        current.map((file) => [file.name, file.size, file.lastModified].join('|'))
      )
      const additions = Array.from(incomingFiles || []).filter((file) => {
        const key = [file.name, file.size, file.lastModified].join('|')
        return existing.has(key) ? false : (existing.add(key), true)
      })
      return [...current, ...additions]
    })
  }

  function removeQueuedFile(setter, index) {
    setter((current) => current.filter((_, fileIndex) => fileIndex !== index))
  }

  async function loadMedia(productId) {
    if (!productId) return setMedia([])
    try {
      const data = await api('/api/admin/products/' + productId + '/media')
      setMedia(Array.isArray(data) ? data : [])
    } catch (error) {
      setMediaError(error.message)
    }
  }

  useEffect(() => {
    if (editing) loadMedia(product.id)
  }, [editing, product?.id])

  async function removeMedia(item) {
    if (!window.confirm('Excluir esta mídia do produto?')) return
    try {
      await api('/api/admin/products/' + item.product_id + '/media/' + item.id, { method: 'DELETE' })
      await loadMedia(item.product_id)
    } catch (error) {
      alert(error.message)
    }
  }

  async function submit(event) {
    event.preventDefault()
    setSaving(true)
    setMediaError('')
    try {
      const saved = await api(editing ? '/api/admin/products/' + product.id : '/api/admin/products', {
        method: editing ? 'PUT' : 'POST',
        body: {
          ...form,
          price: Number(form.price || 0),
          cost: Number(form.cost || 0),
          stock: Number(form.stock || 0),
          min_stock: Number(form.min_stock || 0),
          category_id: Number(form.category_id) || null
        }
      })

      const productId = saved?.id || product?.id
      const files = [...imageFiles, ...videoFiles]
      if (productId && files.length) {
        setUploading(true)
        setUploadProgress({ done: 0, total: files.length })
        try {
          await uploadMedia(productId, files, (done, total) => {
            setUploadProgress({ done, total })
          })
        } finally {
          setUploading(false)
          setUploadProgress({ done: 0, total: 0 })
        }
      }

      onDone()
    } catch (error) {
      alert(error.message)
    } finally {
      setSaving(false)
      setUploading(false)
    }
  }

  return (
    <div className="modal-backdrop">
      <form className="admin-modal admin-modal-wide" onSubmit={submit}>
        <button type="button" className="modal-close" onClick={onClose}>×</button>
        <span className="eyebrow">{editing ? 'PRODUTO / EDITAR' : 'PRODUTO / NOVO'}</span>
        <h2>{editing ? 'Editar produto' : 'Cadastrar produto'}</h2>

        <div className="admin-form-grid">
          <label>Nome<input value={form.name} onChange={(e) => set('name', e.target.value)} required /></label>
          <label>Marca<input value={form.brand} onChange={(e) => set('brand', e.target.value)} placeholder="Ex.: Nike, Adidas…" /></label>
          <label>Categoria<select value={form.category_id} onChange={(e) => set('category_id', e.target.value)}><option value="">Sem categoria</option>{categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
          <label>Preço de venda<input type="number" min="0" step="0.01" value={form.price} onChange={(e) => set('price', e.target.value)} required /></label>
          <label>Custo<input type="number" min="0" step="0.01" value={form.cost} onChange={(e) => set('cost', e.target.value)} /></label>
          <label>Estoque inicial / atual<input type="number" min="0" step="1" value={form.stock} onChange={(e) => set('stock', e.target.value)} required /></label>
          <label>Estoque mínimo<input type="number" min="0" step="1" value={form.min_stock} onChange={(e) => set('min_stock', e.target.value)} /></label>
          <label>Status<select value={form.active ? '1' : '0'} onChange={(e) => set('active', e.target.value === '1')}><option value="1">Ativo no site</option><option value="0">Oculto</option></select></label>
        </div>

        <label>Descrição<textarea value={form.description} onChange={(e) => set('description', e.target.value)} rows="4" placeholder="Descrição, composição, medidas, cuidados…" /></label>

        <div className="admin-form-grid">
          <label>URL da foto principal<input value={form.image} onChange={(e) => set('image', e.target.value)} placeholder="https://..." /></label>
          <label>URL do vídeo<input value={form.video} onChange={(e) => set('video', e.target.value)} placeholder="https://..." /></label>
        </div>

        <div className="admin-media-upload">
          <div>
            <span className="eyebrow">MÍDIA / UPLOAD</span>
            <h3>Fotos do produto</h3>
            <p>Selecione várias fotos. Você pode repetir a seleção e todas serão acumuladas antes de salvar.</p>
            <input
              type="file"
              accept="image/jpeg,image/png,image/webp"
              multiple
              onChange={(e) => {
                appendFiles(setImageFiles, e.target.files)
                e.target.value = ''
              }}
            />
            {imageFiles.length > 0 && (
              <div className="admin-queued-media">
                <small>{imageFiles.length} foto(s) na fila</small>
                {imageFiles.map((file, index) => (
                  <div className="admin-queued-item" key={[file.name, file.size, file.lastModified].join('|')}>
                    <span>{file.name}</span>
                    <button type="button" onClick={() => removeQueuedFile(setImageFiles, index)}>Remover</button>
                  </div>
                ))}
              </div>
            )}
          </div>
          <div>
            <h3>Vídeos do produto</h3>
            <p>MP4, WebM ou MOV, até 25 MB cada. Os arquivos também podem ser adicionados em várias seleções.</p>
            <input
              type="file"
              accept="video/mp4,video/webm,video/quicktime"
              multiple
              onChange={(e) => {
                appendFiles(setVideoFiles, e.target.files)
                e.target.value = ''
              }}
            />
            {videoFiles.length > 0 && (
              <div className="admin-queued-media">
                <small>{videoFiles.length} vídeo(s) na fila</small>
                {videoFiles.map((file, index) => (
                  <div className="admin-queued-item" key={[file.name, file.size, file.lastModified].join('|')}>
                    <span>{file.name}</span>
                    <button type="button" onClick={() => removeQueuedFile(setVideoFiles, index)}>Remover</button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {uploading && (
          <div className="admin-media-note">
            Enviando {uploadProgress.done} de {uploadProgress.total} arquivo(s) para o armazenamento de mídia…
          </div>
        )}

        {editing && (
          <div>
            <span className="eyebrow">MÍDIA / GALERIA ATUAL</span>
            {mediaError && <p className="admin-error">{mediaError}</p>}
            <div className="media-gallery">
              {media.map((item) => (
                <div className="media-tile" key={item.id}>
                  {item.media_type === 'video'
                    ? <video src={item.url} controls muted preload="metadata" />
                    : <img src={item.url} alt="" loading="lazy" />}
                  <div><span>{item.media_type === 'video' ? 'Vídeo' : 'Foto'}</span><button type="button" onClick={() => removeMedia(item)}>Excluir</button></div>
                </div>
              ))}
              {!media.length && <p className="page-note">Nenhuma mídia enviada ainda.</p>}
            </div>
          </div>
        )}

        <div className="admin-media-note">
          O arquivo é enviado para o armazenamento de mídia e o banco guarda apenas o endereço e os metadados. O Render não é usado como armazenamento permanente.
        </div>

        <button className="button button-primary" disabled={saving || uploading}>
          {uploading ? 'Enviando mídia…' : saving ? 'Salvando…' : 'Salvar produto'}
        </button>
      </form>
    </div>
  )
}

function StockModal({ products, onClose, onDone }) {
  const [form, setForm] = useState({ product_id: '', type: 'ENTRADA', quantity: '', reason: '' })
  const [saving, setSaving] = useState(false)
  const set = (k, v) => setForm((c) => ({ ...c, [k]: v }))

  async function submit(event) {
    event.preventDefault()
    setSaving(true)
    try {
      await api('/api/admin/stock', {
        method: 'POST',
        body: {
          ...form,
          product_id: Number(form.product_id),
          quantity: Number(form.quantity)
        }
      })
      onDone()
    } catch (error) {
      alert(error.message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="modal-backdrop">
      <form className="admin-modal" onSubmit={submit}>
        <button type="button" className="modal-close" onClick={onClose}>×</button>
        <span className="eyebrow">ESTOQUE</span>
        <h2>Movimentar estoque</h2>
        <select value={form.product_id} onChange={(e) => set('product_id', e.target.value)} required>
          <option value="">Selecione o produto</option>
          {products.map((p) => <option key={p.id} value={p.id}>{p.name} — {p.stock} un.</option>)}
        </select>
        <select value={form.type} onChange={(e) => set('type', e.target.value)}>
          <option value="ENTRADA">Entrada</option>
          <option value="SAIDA">Saída</option>
        </select>
        <input type="number" min="1" step="1" value={form.quantity} onChange={(e) => set('quantity', e.target.value)} placeholder="Quantidade" required />
        <input value={form.reason} onChange={(e) => set('reason', e.target.value)} placeholder="Motivo" />
        <button className="button button-primary" disabled={saving}>{saving ? 'Salvando…' : 'Confirmar'}</button>
      </form>
    </div>
  )
}

function SaleModal({ products, onClose, onDone }) {
  const [customerName, setCustomerName] = useState('')
  const [paymentMethod, setPaymentMethod] = useState('PIX')
  const [notes, setNotes] = useState('')
  const [items, setItems] = useState([{ product_id: '', quantity: 1 }])
  const [saving, setSaving] = useState(false)

  const setItem = (index, key, value) => {
    setItems((current) => current.map((item, i) => i === index ? { ...item, [key]: value } : item))
  }
  const addItem = () => setItems((current) => [...current, { product_id: '', quantity: 1 }])
  const removeItem = (index) => setItems((current) => current.length === 1 ? current : current.filter((_, i) => i !== index))

  const estimatedTotal = useMemo(() => items.reduce((sum, item) => {
    const product = products.find((p) => Number(p.id) === Number(item.product_id))
    return sum + (product ? Number(product.price) * Number(item.quantity || 0) : 0)
  }, 0), [items, products])

  async function submit(event) {
    event.preventDefault()
    setSaving(true)
    try {
      await api('/api/admin/sales', {
        method: 'POST',
        body: {
          customer_name: customerName,
          payment_method: paymentMethod,
          notes,
          items: items.map((item) => ({
            product_id: Number(item.product_id),
            quantity: Number(item.quantity)
          }))
        }
      })
      onDone()
    } catch (error) {
      alert(error.message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="modal-backdrop">
      <form className="admin-modal admin-modal-wide" onSubmit={submit}>
        <button type="button" className="modal-close" onClick={onClose}>×</button>
        <span className="eyebrow">VENDAS / NOVA</span>
        <h2>Registrar venda</h2>
        <div className="admin-form-grid">
          <label>Cliente<input value={customerName} onChange={(e) => setCustomerName(e.target.value)} placeholder="Nome opcional" /></label>
          <label>Pagamento<select value={paymentMethod} onChange={(e) => setPaymentMethod(e.target.value)}><option>PIX</option><option>CARTAO_CREDITO</option><option>CARTAO_DEBITO</option><option>DINHEIRO</option><option>TRANSFERENCIA</option><option>OUTRO</option></select></label>
        </div>

        <div className="sale-items">
          {items.map((item, index) => (
            <div className="sale-item" key={index}>
              <select value={item.product_id} onChange={(e) => setItem(index, 'product_id', e.target.value)} required>
                <option value="">Produto</option>
                {products.filter((p) => Number(p.stock) > 0).map((p) => <option key={p.id} value={p.id}>{p.name} — {money(p.price)} — {p.stock} em estoque</option>)}
              </select>
              <input type="number" min="1" step="1" value={item.quantity} onChange={(e) => setItem(index, 'quantity', e.target.value)} required />
              <button type="button" onClick={() => removeItem(index)}>Remover</button>
            </div>
          ))}
        </div>

        <button className="text-button" type="button" onClick={addItem}>+ adicionar item</button>
        <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows="3" placeholder="Observações da venda" />
        <div className="sale-total"><span>Total estimado</span><strong>{money(estimatedTotal)}</strong></div>
        <button className="button button-primary" disabled={saving}>{saving ? 'Registrando…' : 'Finalizar venda'}</button>
      </form>
    </div>
  )
}

function FinanceModal({ categories, accounts, onClose, onDone }) {
  const [form, setForm] = useState({
    type: 'DESPESA',
    status: 'PENDENTE',
    description: '',
    amount: '',
    due_date: '',
    category_id: '',
    account_id: ''
  })
  const [saving, setSaving] = useState(false)
  const set = (k, v) => setForm((c) => ({ ...c, [k]: v }))

  const filtered = categories.filter((c) => c.type === form.type)

  async function submit(event) {
    event.preventDefault()
    setSaving(true)
    try {
      await api('/api/admin/finance/entries', {
        method: 'POST',
        body: {
          ...form,
          amount: Number(form.amount),
          category_id: Number(form.category_id) || null,
          account_id: Number(form.account_id) || null
        }
      })
      onDone()
    } catch (error) {
      alert(error.message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="modal-backdrop">
      <form className="admin-modal" onSubmit={submit}>
        <button type="button" className="modal-close" onClick={onClose}>×</button>
        <span className="eyebrow">FINANCEIRO / NOVO</span>
        <h2>Novo lançamento</h2>
        <select value={form.type} onChange={(e) => set('type', e.target.value)}>
          <option value="DESPESA">Despesa</option>
          <option value="RECEITA">Receita</option>
        </select>
        <input value={form.description} onChange={(e) => set('description', e.target.value)} placeholder="Descrição" required />
        <input type="number" min="0.01" step="0.01" value={form.amount} onChange={(e) => set('amount', e.target.value)} placeholder="Valor" required />
        <select value={form.category_id} onChange={(e) => set('category_id', e.target.value)} required>
          <option value="">Categoria</option>
          {filtered.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
        <select value={form.account_id} onChange={(e) => set('account_id', e.target.value)}>
          <option value="">Conta</option>
          {accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
        </select>
        <input type="date" value={form.due_date} onChange={(e) => set('due_date', e.target.value)} />
        <select value={form.status} onChange={(e) => set('status', e.target.value)}><option value="PENDENTE">Pendente</option><option value="PAGO">Pago</option></select>
        <button className="button button-primary" disabled={saving}>{saving ? 'Salvando…' : 'Salvar lançamento'}</button>
      </form>
    </div>
  )
}

function RecurringModal({ categories, accounts, onClose, onDone }) {
  const [form, setForm] = useState({ description: '', amount: '', due_day: 10, category_id: '', account_id: '' })
  const [saving, setSaving] = useState(false)
  const set = (k, v) => setForm((c) => ({ ...c, [k]: v }))

  async function submit(event) {
    event.preventDefault()
    setSaving(true)
    try {
      await api('/api/admin/finance/recurring', {
        method: 'POST',
        body: {
          ...form,
          amount: Number(form.amount),
          due_day: Number(form.due_day),
          category_id: Number(form.category_id) || null,
          account_id: Number(form.account_id) || null
        }
      })
      onDone()
    } catch (error) {
      alert(error.message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="modal-backdrop">
      <form className="admin-modal" onSubmit={submit}>
        <button type="button" className="modal-close" onClick={onClose}>×</button>
        <span className="eyebrow">FINANCEIRO / RECORRÊNCIA</span>
        <h2>Nova conta recorrente</h2>
        <input value={form.description} onChange={(e) => set('description', e.target.value)} placeholder="Ex.: Aluguel" required />
        <input type="number" min="0.01" step="0.01" value={form.amount} onChange={(e) => set('amount', e.target.value)} placeholder="Valor mensal" required />
        <input type="number" min="1" max="31" value={form.due_day} onChange={(e) => set('due_day', e.target.value)} placeholder="Dia do vencimento" required />
        <select value={form.category_id} onChange={(e) => set('category_id', e.target.value)} required>
          <option value="">Categoria</option>
          {categories.filter((c) => c.type === 'DESPESA').map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
        <select value={form.account_id} onChange={(e) => set('account_id', e.target.value)}>
          <option value="">Conta</option>
          {accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
        </select>
        <button className="button button-primary" disabled={saving}>{saving ? 'Salvando…' : 'Criar recorrência'}</button>
      </form>
    </div>
  )
}

function Admin({ user, onLogout }) {
  const [tab, setTab] = useState('dashboard')
  const [dash, setDash] = useState(null)
  const [products, setProducts] = useState([])
  const [entries, setEntries] = useState([])
  const [categories, setCategories] = useState([])
  const [accounts, setAccounts] = useState([])
  const [recurring, setRecurring] = useState([])
  const [movements, setMovements] = useState([])
  const [sales, setSales] = useState([])
  const [loading, setLoading] = useState(true)
  const [modal, setModal] = useState(null)
  const [editingProduct, setEditingProduct] = useState(null)

  async function load() {
    setLoading(true)
    try {
      const [d, p, e, c, a, r, m, s] = await Promise.all([
        api('/api/admin/dashboard'),
        api('/api/admin/products'),
        api('/api/admin/finance/entries'),
        api('/api/admin/finance/categories'),
        api('/api/admin/finance/accounts'),
        api('/api/admin/finance/recurring'),
        api('/api/admin/stock/movements'),
        api('/api/admin/sales')
      ])
      setDash(d)
      setProducts(p)
      setEntries(e)
      setCategories(c)
      setAccounts(a)
      setRecurring(r)
      setMovements(m)
      setSales(s)
    } catch (error) {
      if (error.message.includes('Sessão') || error.message.includes('conta')) onLogout()
      else alert(error.message)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    load()
  }, [])

  async function pay(id) {
    try {
      await api('/api/admin/finance/entries/' + id + '/pay', { method: 'PATCH' })
      await load()
    } catch (error) {
      alert(error.message)
    }
  }

  async function cancelSale(id) {
    if (!window.confirm('Cancelar esta venda? O estoque e o financeiro serão estornados.')) return
    try {
      await api('/api/admin/sales/' + id + '/cancel', { method: 'PATCH' })
      await load()
    } catch (error) {
      alert(error.message)
    }
  }

  async function logout() {
    try { await api('/api/auth/logout', { method: 'POST' }) } catch {}
    onLogout()
  }

  const title = {
    dashboard: 'Visão geral',
    products: 'Produtos e estoque',
    sales: 'Vendas',
    finance: 'Financeiro',
    recurring: 'Contas recorrentes',
    movements: 'Histórico de estoque'
  }[tab]

  const cta = {
    products: ['+ Cadastrar produto', () => { setEditingProduct(null); setModal('product') }],
    sales: ['+ Registrar venda', () => setModal('sale')],
    finance: ['+ Registrar lançamento', () => setModal('finance')],
    recurring: ['+ Nova recorrência', () => setModal('recurring')],
    movements: ['+ Movimentar estoque', () => setModal('stock')]
  }[tab]

  return (
    <div className="admin-shell">
      <aside className="admin-side">
        <div className="brand"><span className="brand-mark">G</span><span>GALEO</span></div>
        {[
          ['dashboard', 'Visão geral'],
          ['products', 'Produtos e estoque'],
          ['sales', 'Vendas'],
          ['finance', 'Financeiro'],
          ['recurring', 'Contas recorrentes'],
          ['movements', 'Histórico de estoque']
        ].map(([key, label]) => (
          <button className={tab === key ? 'admin-nav active' : 'admin-nav'} onClick={() => setTab(key)} key={key}>{label}</button>
        ))}
        <div className="admin-user"><strong>{user?.email}</strong><small>{user?.role}</small></div>
        <button className="admin-nav logout" onClick={logout}>Sair</button>
      </aside>

      <main className="admin-main">
        <div className="admin-top">
          <div>
            <span className="eyebrow">ADMIN / {String(user?.id || '').padStart(3, '0')}</span>
            <h1>{title}</h1>
          </div>
          {cta && <button className="button button-primary" onClick={cta[1]}>{cta[0]}</button>}
        </div>

        {loading ? <div className="admin-loading">Carregando dados reais…</div> : null}

        {!loading && tab === 'dashboard' && (
          <>
            <div className="metric-grid metric-grid-extended">
              <div className="metric"><span>Produtos ativos</span><strong>{dash.products.count}</strong></div>
              <div className="metric"><span>Unidades em estoque</span><strong>{dash.products.stock}</strong></div>
              <div className="metric"><span>Produtos em estoque baixo</span><strong>{dash.products.low_stock}</strong></div>
              <div className="metric"><span>Vendas no mês</span><strong>{dash.sales.count}</strong></div>
              <div className="metric"><span>Receita de vendas</span><strong>{money(dash.sales.total)}</strong></div>
              <div className="metric"><span>Outras receitas</span><strong>{money(dash.income)}</strong></div>
              <div className="metric"><span>Despesas pagas</span><strong>{money(dash.expense)}</strong></div>
              <div className="metric"><span>Resultado do mês</span><strong>{money(Number(dash.sales.total || 0) + Number(dash.income || 0) - Number(dash.expense || 0))}</strong></div>
              <div className="metric"><span>A pagar</span><strong>{money(dash.payable)}</strong></div>
              <div className="metric"><span>A receber</span><strong>{money(dash.receivable)}</strong></div>
              <div className="metric"><span>Entradas de estoque</span><strong>+{dash.stock.entradas}</strong></div>
              <div className="metric"><span>Saídas de estoque</span><strong>-{dash.stock.saidas}</strong></div>
            </div>
            <div className="admin-panel dashboard-split">
              <div><span className="eyebrow">ATENÇÃO</span><h2>Estoque crítico</h2><p>{dash.products.low_stock} produto(s) no estoque mínimo ou abaixo.</p></div>
              <div><span className="eyebrow">ÚLTIMA VENDA</span><h2>{sales[0]?.code || 'Ainda não há vendas'}</h2><p>{sales[0] ? money(sales[0].total) + ' · ' + dateBR(sales[0].sold_at) : 'Registre a primeira venda pelo painel.'}</p></div>
            </div>
          </>
        )}

        {!loading && tab === 'products' && (
          <div className="admin-panel">
            <table>
              <thead><tr><th>Produto</th><th>Marca</th><th>Preço</th><th>Custo</th><th>Estoque</th><th>Status</th><th></th></tr></thead>
              <tbody>
                {products.map((product) => (
                  <tr key={product.id}>
                    <td><strong>{product.name}</strong><small>{product.category || 'Sem categoria'}</small></td>
                    <td>{product.brand || '—'}</td>
                    <td>{money(product.price)}</td>
                    <td>{money(product.cost)}</td>
                    <td><strong>{product.stock}</strong>{product.stock <= product.min_stock && <small className="warn"> estoque baixo</small>}</td>
                    <td>{Number(product.active) ? 'Ativo' : 'Oculto'}</td>
                    <td className="admin-actions">
                      <button onClick={() => { setEditingProduct(product); setModal('product') }}>Editar</button>
                      <button onClick={() => { setModal('stock'); setEditingProduct(product) }}>Estoque</button>
                    </td>
                  </tr>
                ))}
                {!products.length && <tr><td colSpan="7" className="empty-state">Nenhum produto cadastrado ainda.</td></tr>}
              </tbody>
            </table>
          </div>
        )}

        {!loading && tab === 'sales' && (
          <div className="admin-panel">
            <table>
              <thead><tr><th>Venda</th><th>Cliente</th><th>Pagamento</th><th>Data</th><th>Itens</th><th>Total</th><th>Status</th><th></th></tr></thead>
              <tbody>
                {sales.map((sale) => (
                  <tr key={sale.id}>
                    <td><strong>{sale.code}</strong></td>
                    <td>{sale.customer_name || 'Consumidor final'}</td>
                    <td>{String(sale.payment_method || '').replaceAll('_', ' ')}</td>
                    <td>{dateBR(sale.sold_at)}</td>
                    <td>{sale.items_count}</td>
                    <td><strong>{money(sale.total)}</strong></td>
                    <td><span className={'status-pill status-' + String(sale.status).toLowerCase()}>{sale.status}</span></td>
                    <td>{sale.status === 'PAGA' && <button onClick={() => cancelSale(sale.id)}>Cancelar</button>}</td>
                  </tr>
                ))}
                {!sales.length && <tr><td colSpan="8" className="empty-state">Nenhuma venda registrada.</td></tr>}
              </tbody>
            </table>
          </div>
        )}

        {!loading && tab === 'finance' && (
          <div className="admin-panel">
            <table>
              <thead><tr><th>Tipo</th><th>Descrição</th><th>Categoria</th><th>Conta</th><th>Vencimento</th><th>Valor</th><th>Status</th><th></th></tr></thead>
              <tbody>
                {entries.map((entry) => (
                  <tr key={entry.id}>
                    <td>{entry.type}</td>
                    <td><strong>{entry.description}</strong>{entry.reference_type && <small>{entry.reference_type}</small>}</td>
                    <td>{entry.category || '—'}</td>
                    <td>{entry.account || '—'}</td>
                    <td>{dateBR(entry.due_date)}</td>
                    <td>{money(entry.amount)}</td>
                    <td><span className={'status-pill status-' + String(entry.status).toLowerCase()}>{entry.status}</span></td>
                    <td>{entry.status === 'PENDENTE' && <button onClick={() => pay(entry.id)}>Marcar pago</button>}</td>
                  </tr>
                ))}
                {!entries.length && <tr><td colSpan="8" className="empty-state">Nenhum lançamento financeiro.</td></tr>}
              </tbody>
            </table>
          </div>
        )}

        {!loading && tab === 'recurring' && (
          <div className="admin-panel">
            <table>
              <thead><tr><th>Despesa</th><th>Categoria</th><th>Conta</th><th>Valor</th><th>Dia</th><th>Status</th></tr></thead>
              <tbody>
                {recurring.map((item) => (
                  <tr key={item.id}><td>{item.description}</td><td>{item.category || '—'}</td><td>{item.account || '—'}</td><td>{money(item.amount)}</td><td>{item.due_day}</td><td>{Number(item.active) ? 'Ativa' : 'Inativa'}</td></tr>
                ))}
                {!recurring.length && <tr><td colSpan="6" className="empty-state">Nenhuma conta recorrente cadastrada.</td></tr>}
              </tbody>
            </table>
          </div>
        )}

        {!loading && tab === 'movements' && (
          <div className="admin-panel">
            <table>
              <thead><tr><th>Data</th><th>Produto</th><th>Tipo</th><th>Quantidade</th><th>Antes</th><th>Depois</th><th>Motivo</th></tr></thead>
              <tbody>
                {movements.map((m) => (
                  <tr key={m.id}><td>{dateBR(m.created_at)}</td><td>{m.product}</td><td>{m.type}</td><td>{m.quantity}</td><td>{m.stock_before}</td><td>{m.stock_after}</td><td>{m.reason || '—'}</td></tr>
                ))}
                {!movements.length && <tr><td colSpan="7" className="empty-state">Nenhuma movimentação registrada.</td></tr>}
              </tbody>
            </table>
          </div>
        )}
      </main>

      {modal === 'product' && <ProductForm product={editingProduct} categories={categories} onClose={() => setModal(null)} onDone={() => { setModal(null); setEditingProduct(null); load() }} />}
      {modal === 'stock' && <StockModal products={products} onClose={() => setModal(null)} onDone={() => { setModal(null); load() }} />}
      {modal === 'sale' && <SaleModal products={products} onClose={() => setModal(null)} onDone={() => { setModal(null); load() }} />}
      {modal === 'finance' && <FinanceModal categories={categories} accounts={accounts} onClose={() => setModal(null)} onDone={() => { setModal(null); load() }} />}
      {modal === 'recurring' && <RecurringModal categories={categories} accounts={accounts} onClose={() => setModal(null)} onDone={() => { setModal(null); load() }} />}
    </div>
  )
}

export default function AdminGate() {
  const [user, setUser] = useState(null)
  const [checking, setChecking] = useState(true)

  useEffect(() => {
    api('/api/auth/me')
      .then((data) => setUser(data.user))
      .catch(() => {})
      .finally(() => setChecking(false))
  }, [])

  if (checking) return <main className="admin-login"><p>Verificando sessão...</p></main>
  return user
    ? <Admin user={user} onLogout={() => setUser(null)} />
    : <Login onLogin={setUser} />
}
