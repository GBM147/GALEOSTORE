import { useEffect, useMemo, useState } from 'react'
import MediaLibrary from './MediaLibrary'
let csrfToken = ''

const api = async (path, options = {}) => {
  const headers = new Headers(options.headers || {})
  if (options.body && typeof options.body !== 'string') {
    headers.set('Content-Type', 'application/json')
    options = { ...options, body: JSON.stringify(options.body) }
  }

  const method = String(options.method || 'GET').toUpperCase()
  if (!['GET', 'HEAD', 'OPTIONS'].includes(method) && path !== '/api/auth/login' && csrfToken) {
    headers.set('X-CSRF-Token', csrfToken)
  }

  const response = await fetch(path, {
    ...options,
    headers,
    credentials: 'include'
  })

  const raw = await response.text()
  let data = null
  try { data = raw ? JSON.parse(raw) : null } catch {}

  if (data?.csrfToken) csrfToken = data.csrfToken
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
  if (!productId) throw new Error('Salve o produto antes de enviar as imagens.')
  if (!files.length) return { success: true, media: [] }

  const batchSize = 8
  const results = []

  for (let start = 0; start < files.length; start += batchSize) {
    const batch = files.slice(start, start + batchSize)
    const formData = new FormData()
    batch.forEach((file) => formData.append('media', file))

    const headers = {}
    if (csrfToken) headers['X-CSRF-Token'] = csrfToken

    const response = await fetch('/api/admin/products/' + productId + '/media', {
      method: 'POST',
      body: formData,
      credentials: 'include',
      headers
    })

    const raw = await response.text()
    let data = null
    try { data = raw ? JSON.parse(raw) : null } catch {}

    if (!response.ok) {
      throw new Error(data?.error || 'Não foi possível enviar a mídia.')
    }

    if (!Array.isArray(data?.media)) {
      throw new Error('O servidor não confirmou o envio das imagens.')
    }

    results.push(...data.media)
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

  async function enviarMidiaAtual() {
    const files = [...imageFiles, ...videoFiles]
    if (!editing || !product?.id || !files.length) return

    setUploading(true)
    setMediaError('')
    setUploadProgress({ done: 0, total: files.length })

    try {
      await uploadMedia(product.id, files, (done, total) => {
        setUploadProgress({ done, total })
      })
      setImageFiles([])
      setVideoFiles([])
      await loadMedia(product.id)
    } catch (error) {
      setMediaError(error.message)
    } finally {
      setUploading(false)
      setUploadProgress({ done: 0, total: 0 })
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

      // O produto pode ser novo ou estar sendo editado. Em ambos os casos,
      // qualquer mídia selecionada nesta tela precisa ser enviada antes
      // de fechar o formulário.
      if (productId && files.length) {
        setUploading(true)
        setUploadProgress({ done: 0, total: files.length })
        try {
          await uploadMedia(productId, files, (done, total) => {
            setUploadProgress({ done, total })
          })
          setImageFiles([])
          setVideoFiles([])
          await loadMedia(productId)
        } catch (error) {
          setMediaError(error.message)
          setSaving(false)
          return
        } finally {
          setUploading(false)
          setUploadProgress({ done: 0, total: 0 })
        }
      }

      onDone()
    } catch (error) {
      setMediaError(error.message)
      setSaving(false)
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
            <p>Selecione várias fotos de uma vez ou adicione mais em novas seleções. JPG, JPEG, JFIF, PNG, WebP e AVIF. O arquivo deve aparecer na fila imediatamente após a seleção.</p>
            <input
              type="file"
              accept="image/*,.jpg,.jpeg,.jfif,.png,.webp,.avif"
              multiple
              onChange={(e) => {
                const selected = Array.from(e.target.files || [])
                appendFiles(setImageFiles, selected)
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

        {mediaError && (
          <div className="admin-media-note admin-media-error">
            {mediaError}
          </div>
        )}

        {editing && [...imageFiles, ...videoFiles].length > 0 && (
          <button
            type="button"
            className="button button-primary"
            onClick={enviarMidiaAtual}
            disabled={saving || uploading}
          >
            {uploading
              ? 'Enviando mídia…'
              : `Enviar ${[...imageFiles, ...videoFiles].length} arquivo(s) agora ↗`}
          </button>
        )}

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


function PasswordModal({ onClose, onDone }) {
  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  async function submit(event) {
    event.preventDefault()
    setError('')
    if (newPassword !== confirmPassword) return setError('As novas senhas não conferem.')
    if (newPassword.length < 10) return setError('A nova senha deve ter pelo menos 10 caracteres.')
    setSaving(true)
    try {
      await api('/api/auth/password', {
        method: 'PATCH',
        body: { currentPassword, newPassword }
      })
      alert('Senha alterada com sucesso.')
      onDone()
    } catch (err) {
      setError(err.message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="modal-backdrop">
      <form className="admin-modal" onSubmit={submit}>
        <button type="button" className="modal-close" onClick={onClose}>×</button>
        <span className="eyebrow">SEGURANÇA / SENHA</span>
        <h2>Alterar senha</h2>
        <input type="password" autoComplete="current-password" value={currentPassword} onChange={(e) => setCurrentPassword(e.target.value)} placeholder="Senha atual" required />
        <input type="password" autoComplete="new-password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} placeholder="Nova senha (mínimo 10 caracteres)" required />
        <input type="password" autoComplete="new-password" value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} placeholder="Confirme a nova senha" required />
        {error && <p className="admin-error">{error}</p>}
        <button className="button button-primary" disabled={saving}>{saving ? 'Alterando…' : 'Alterar senha'}</button>
      </form>
    </div>
  )
}


const HOME_EDITOR_META = {
  hero: ['Hero', 'Hero principal da página inicial'],
  utility: ['Faixa informativa', 'Benefícios e mensagens curtas'],
  categories: ['Categorias', 'Blocos de categorias da vitrine'],
  featured_products: ['Produtos destaque', 'Seleção de produtos em evidência'],
  campaigns: ['Campanhas', 'Banners editoriais da Home'],
  manifesto: ['Manifesto', 'Mensagem institucional'],
  newsletter: ['Newsletter', 'Captação de e-mails']
}

function HomeEditor({ user }) {
  const [sections, setSections] = useState([])
  const [settings, setSettings] = useState({})
  const [mediaItems, setMediaItems] = useState([])
  const [products, setProducts] = useState([])
  const [selectedKey, setSelectedKey] = useState('hero')
  const [area, setArea] = useState('content')
  const [draft, setDraft] = useState(null)
  const [visible, setVisible] = useState(true)
  const [order, setOrder] = useState(10)
  const [visual, setVisual] = useState(null)
  const [navigation, setNavigation] = useState(null)
  const [footer, setFooter] = useState(null)
  const [campaignDefaults, setCampaignDefaults] = useState(null)
  const [saving, setSaving] = useState(false)
  const [status, setStatus] = useState('')

  async function loadHome() {
    const [homeData, settingsData, mediaData, productData] = await Promise.all([
      api('/api/admin/home'),
      api('/api/admin/home/settings'),
      api('/api/admin/media-library?limit=100'),
      api('/api/admin/products')
    ])
    const nextSections = Array.isArray(homeData?.sections) ? homeData.sections : []
    setSections(nextSections)
    const selected = nextSections.find((section) => section.key === selectedKey) || nextSections[0]
    if (selected) {
      setDraft(selected.draft || {})
      setVisible(Boolean(selected.visible))
      setOrder(Number(selected.order || 0))
      setSelectedKey(selected.key)
    }
    const nextSettings = Object.fromEntries((settingsData?.settings || []).map((item) => [item.key, item.value]))
    setSettings(nextSettings)
    setVisual(nextSettings.storefront_visual_defaults || null)
    setNavigation(nextSettings.navigation || { items: [] })
    setFooter(nextSettings.footer || { brand: 'GALEO STORE', location: 'São Paulo / BR', year: '2026' })
    setCampaignDefaults(nextSettings.campaign_defaults || { effect: 'zoom', transition: 'crossfade', speed: 'slow', duration_seconds: 6 })
    setMediaItems(Array.isArray(mediaData?.items) ? mediaData.items : [])
    setProducts(Array.isArray(productData) ? productData : [])
  }

  useEffect(() => {
    if (user?.role === 'owner') loadHome().catch((error) => setStatus(error.message))
  }, [user?.role])

  useEffect(() => {
    const section = sections.find((item) => item.key === selectedKey)
    if (section) {
      setDraft(section.draft || {})
      setVisible(Boolean(section.visible))
      setOrder(Number(section.order || 0))
    }
  }, [selectedKey, sections])

  function setField(key, value) {
    setDraft((current) => ({ ...(current || {}), [key]: value }))
  }
  function setArrayItem(key, index, value) {
    setDraft((current) => ({ ...(current || {}), [key]: (current?.[key] || []).map((item, itemIndex) => itemIndex === index ? value : item) }))
  }
  function addArrayItem(key, value) {
    setDraft((current) => ({ ...(current || {}), [key]: [...(current?.[key] || []), value] }))
  }
  function removeArrayItem(key, index) {
    setDraft((current) => ({ ...(current || {}), [key]: (current?.[key] || []).filter((_, itemIndex) => itemIndex !== index) }))
  }
  function moveArrayItem(key, index, direction) {
    setDraft((current) => {
      const items = [...(current?.[key] || [])]
      const next = index + direction
      if (next < 0 || next >= items.length) return current
      ;[items[index], items[next]] = [items[next], items[index]]
      return { ...(current || {}), [key]: items }
    })
  }

  async function saveSection() {
    if (!draft) return
    setSaving(true)
    setStatus('')
    try {
      await api('/api/admin/home/' + selectedKey, { method: 'PUT', body: { content: draft, visible, order } })
      await loadHome()
      setStatus('Rascunho salvo')
    } catch (error) {
      setStatus(error.message)
    } finally { setSaving(false) }
  }

  async function publishAll() {
    setSaving(true)
    setStatus('')
    try {
      await api('/api/admin/home/publish', { method: 'POST' })
      await loadHome()
      setStatus('Home publicada')
    } catch (error) {
      setStatus(error.message)
    } finally { setSaving(false) }
  }

  async function saveSetting(key, value) {
    setSaving(true)
    setStatus('')
    try {
      await api('/api/admin/home/settings/' + key, { method: 'PUT', body: { value } })
      await loadHome()
      setStatus('Configuração salva')
    } catch (error) {
      setStatus(error.message)
    } finally { setSaving(false) }
  }

  function mediaOptions(type) { return mediaItems.filter((item) => !type || item.media_type === type) }
  function applyMedia(prefix, item) {
    setDraft((current) => ({ ...(current || {}), [prefix + '_media_id']: item ? Number(item.id) : null, [prefix + '_media_url']: item?.url || '' }))
  }

  const selected = sections.find((section) => section.key === selectedKey)
  const selectedMeta = HOME_EDITOR_META[selectedKey] || [selectedKey, 'Conteúdo da seção']
  const featuredIds = Array.isArray(draft?.product_ids) ? draft.product_ids.map(Number) : []

  if (user?.role !== 'owner') return <div className="admin-panel empty-state">O editor da loja é exclusivo do proprietário</div>

  return (
    <div className="home-editor">
      <div className="home-editor-main">
        <aside className="home-editor-sidebar">
          <div className="home-editor-sidebar-title"><span className="eyebrow">EDITOR DA LOJA</span><strong>Conteúdo da Home</strong><small>Você está editando um rascunho</small></div>
          {sections.map((section) => {
            const meta = HOME_EDITOR_META[section.key] || [section.key, 'Seção']
            return (
              <button type="button" key={section.key} className={area === 'content' && selectedKey === section.key ? 'home-editor-nav active' : 'home-editor-nav'} onClick={() => { setArea('content'); setSelectedKey(section.key) }}>
                <span>{meta[0]}</span><small>{section.visible ? 'Visível' : 'Oculta'}</small>
              </button>
            )
          })}
          <div className="home-editor-divider" />
          <span className="eyebrow home-editor-nav-label">CONFIGURAÇÕES</span>
          {[['visual','Visual'],['navigation','Menu principal'],['footer','Rodapé'],['campaign','Animações']].map(([key,label]) => (
            <button type="button" key={key} className={area === key ? 'home-editor-nav active' : 'home-editor-nav'} onClick={() => setArea(key)}>
              <span>{label}</span><small>Editar</small>
            </button>
          ))}
        </aside>

        <section className="home-editor-workspace">
          <div className="home-editor-heading">
            <div>
              <span className="eyebrow">GALEO / {area === 'content' ? selectedKey.toUpperCase() : area.toUpperCase()}</span>
              <h2>{area === 'content' ? selectedMeta[0] : ({ visual: 'Visual da loja', navigation: 'Menu principal', footer: 'Rodapé', campaign: 'Animações das campanhas' }[area] || 'Editor')}</h2>
              <p>{area === 'content' ? selectedMeta[1] : 'Configurações aplicadas à experiência pública da GALEO'}</p>
            </div>
            {status && <span className="home-editor-status">{status}</span>}
          </div>

          {area === 'content' && draft && (
            <>
              <div className="home-editor-section-toolbar">
                <label>Visibilidade<select value={visible ? '1' : '0'} onChange={(event) => setVisible(event.target.value === '1')}><option value="1">Visível</option><option value="0">Oculta</option></select></label>
                <label>Ordem<input type="number" min="0" max="999" value={order} onChange={(event) => setOrder(Number(event.target.value))} /></label>
              </div>

              {selectedKey === 'hero' && (
                <div className="home-editor-form">
                  <label>Eyebrow<input value={draft.eyebrow || ''} onChange={(e) => setField('eyebrow', e.target.value)} /></label>
                  <label>Título<input value={draft.title || ''} onChange={(e) => setField('title', e.target.value)} /></label>
                  <label className="home-editor-full">Descrição<textarea rows="4" value={draft.description || ''} onChange={(e) => setField('description', e.target.value)} /></label>
                  <label>Texto do botão<input value={draft.button_label || ''} onChange={(e) => setField('button_label', e.target.value)} /></label>
                  <label>Link do botão<input value={draft.button_url || ''} onChange={(e) => setField('button_url', e.target.value)} /></label>
                  <label>Imagem desktop<select value={draft.desktop_media_id || ''} onChange={(e) => applyMedia('desktop', mediaItems.find((item) => Number(item.id) === Number(e.target.value)) || null)}><option value="">Sem imagem</option>{mediaOptions('image').map((item) => <option key={item.id} value={item.id}>{item.title || ('Mídia #' + item.id)}</option>)}</select><input value={draft.desktop_media_url || ''} onChange={(e) => setField('desktop_media_url', e.target.value)} placeholder="URL manual ou Cloudinary" /></label>
                  <label>Imagem mobile<select value={draft.mobile_media_id || ''} onChange={(e) => applyMedia('mobile', mediaItems.find((item) => Number(item.id) === Number(e.target.value)) || null)}><option value="">Sem imagem</option>{mediaOptions('image').map((item) => <option key={item.id} value={item.id}>{item.title || ('Mídia #' + item.id)}</option>)}</select><input value={draft.mobile_media_url || ''} onChange={(e) => setField('mobile_media_url', e.target.value)} placeholder="URL manual ou Cloudinary" /></label>
                  <label>Vídeo<select value={draft.video_media_id || ''} onChange={(e) => applyMedia('video', mediaItems.find((item) => Number(item.id) === Number(e.target.value)) || null)}><option value="">Sem vídeo</option>{mediaOptions('video').map((item) => <option key={item.id} value={item.id}>{item.title || ('Mídia #' + item.id)}</option>)}</select><input value={draft.video_media_url || ''} onChange={(e) => setField('video_media_url', e.target.value)} placeholder="URL manual ou Cloudinary" /></label>
                </div>
              )}

              {selectedKey === 'utility' && (
                <div className="home-editor-list">
                  {(draft.items || []).map((item, index) => (
                    <div className="home-editor-list-row" key={index}>
                      <input value={item || ''} onChange={(e) => { const items = [...(draft.items || [])]; items[index] = e.target.value; setField('items', items) }} />
                      <button type="button" onClick={() => moveArrayItem('items', index, -1)}>↑</button><button type="button" onClick={() => moveArrayItem('items', index, 1)}>↓</button><button type="button" onClick={() => removeArrayItem('items', index)}>Excluir</button>
                    </div>
                  ))}
                  <button className="text-button" type="button" onClick={() => addArrayItem('items','Nova mensagem')}>+ adicionar mensagem</button>
                </div>
              )}

              {selectedKey === 'categories' && (
                <div className="home-editor-list">
                  {(draft.items || []).map((item, index) => (
                    <div className="home-editor-card-row" key={index}>
                      <div className="home-editor-card-grid">
                        <label>Nome<input value={item.title || ''} onChange={(e) => setArrayItem('items', index, { ...item, title: e.target.value })} /></label>
                        <label>Link<input value={item.url || ''} onChange={(e) => setArrayItem('items', index, { ...item, url: e.target.value })} /></label>
                        <label>Mídia<input value={item.media_url || ''} onChange={(e) => setArrayItem('items', index, { ...item, media_url: e.target.value })} placeholder="URL opcional" /></label>
                      </div>
                      <div className="home-editor-row-actions"><button type="button" onClick={() => moveArrayItem('items', index, -1)}>↑</button><button type="button" onClick={() => moveArrayItem('items', index, 1)}>↓</button><button type="button" onClick={() => removeArrayItem('items', index)}>Excluir</button></div>
                    </div>
                  ))}
                  <button className="text-button" type="button" onClick={() => addArrayItem('items',{ title:'Nova categoria', url:'/shop', media_url:'' })}>+ adicionar categoria</button>
                </div>
              )}

              {selectedKey === 'featured_products' && (
                <div className="home-editor-form">
                  <label>Eyebrow<input value={draft.eyebrow || ''} onChange={(e) => setField('eyebrow', e.target.value)} /></label>
                  <label>Título<input value={draft.title || ''} onChange={(e) => setField('title', e.target.value)} /></label>
                  <label>Texto do botão<input value={draft.button_label || ''} onChange={(e) => setField('button_label', e.target.value)} /></label>
                  <label>Link do botão<input value={draft.button_url || ''} onChange={(e) => setField('button_url', e.target.value)} /></label>
                  <label>Fonte<select value={draft.source || 'latest'} onChange={(e) => setField('source', e.target.value)}><option value="latest">Mais recentes</option><option value="manual">Seleção manual</option></select></label>
                  <div className="home-editor-full home-editor-product-picker"><span className="home-editor-field-title">Produtos selecionados</span><div className="home-editor-product-grid">
                    {products.map((product) => {
                      const checked = featuredIds.includes(Number(product.id))
                      return <label key={product.id} className={checked ? 'home-editor-product-pick checked' : 'home-editor-product-pick'}><input type="checkbox" checked={checked} onChange={(e) => { const next = e.target.checked ? [...featuredIds, Number(product.id)] : featuredIds.filter((id) => id !== Number(product.id)); setField('product_ids', next) }} /><span>{product.name}</span><small>{product.brand || 'Sem marca'} · {product.category || 'Sem categoria'}</small></label>
                    })}
                  </div></div>
                </div>
              )}

              {selectedKey === 'campaigns' && (
                <div className="home-editor-list">
                  <div className="home-editor-inline-settings">Os efeitos são configurados em Animações</div>
                  {(draft.items || []).map((item, index) => (
                    <div className="home-editor-card-row" key={index}>
                      <div className="home-editor-card-grid">
                        <label>Eyebrow<input value={item.eyebrow || ''} onChange={(e) => setArrayItem('items', index, { ...item, eyebrow: e.target.value })} /></label>
                        <label>Título<input value={item.title || ''} onChange={(e) => setArrayItem('items', index, { ...item, title: e.target.value })} /></label>
                        <label>Botão<input value={item.button_label || ''} onChange={(e) => setArrayItem('items', index, { ...item, button_label: e.target.value })} /></label>
                        <label>Link<input value={item.button_url || ''} onChange={(e) => setArrayItem('items', index, { ...item, button_url: e.target.value })} /></label>
                        <label className="home-editor-full">Imagem / vídeo<input value={item.media_url || ''} onChange={(e) => setArrayItem('items', index, { ...item, media_url: e.target.value })} placeholder="URL da mídia" /></label>
                      </div>
                      <div className="home-editor-row-actions"><button type="button" onClick={() => moveArrayItem('items', index, -1)}>↑</button><button type="button" onClick={() => moveArrayItem('items', index, 1)}>↓</button><button type="button" onClick={() => removeArrayItem('items', index)}>Excluir</button></div>
                    </div>
                  ))}
                  <button className="text-button" type="button" onClick={() => addArrayItem('items',{ eyebrow:'NOVA CAMPANHA', title:'Nova campanha', button_label:'Explorar', button_url:'/shop', media_url:'' })}>+ adicionar campanha</button>
                </div>
              )}

              {selectedKey === 'manifesto' && <div className="home-editor-form single"><label>Eyebrow<input value={draft.eyebrow || ''} onChange={(e) => setField('eyebrow', e.target.value)} /></label><label>Texto<textarea rows="6" value={draft.text || ''} onChange={(e) => setField('text', e.target.value)} /></label></div>}
              {selectedKey === 'newsletter' && <div className="home-editor-form single"><label>Eyebrow<input value={draft.eyebrow || ''} onChange={(e) => setField('eyebrow', e.target.value)} /></label><label>Título<input value={draft.title || ''} onChange={(e) => setField('title', e.target.value)} /></label><label>Texto do botão<input value={draft.button_label || ''} onChange={(e) => setField('button_label', e.target.value)} /></label></div>}

              <div className="home-editor-savebar">
                <div className="home-editor-save-status">
                  <strong>Rascunho</strong>
                  <small>{selected?.updated_at ? 'Salvo em ' + new Date(selected.updated_at).toLocaleString('pt-BR') : 'Ainda não salvo'}</small>
                  <small>{selected?.published_at ? 'Publicado em ' + new Date(selected.published_at).toLocaleString('pt-BR') : 'Ainda não publicado'}</small>
                </div>
                <div className="home-editor-save-actions">
                  <button className="button button-ghost" type="button" onClick={() => window.open('/?preview=draft&ts=' + Date.now(), '_blank', 'noopener,noreferrer')}>Visualizar rascunho ↗</button>
                  <button className="button button-primary" type="button" onClick={saveSection} disabled={saving}>{saving ? 'Salvando…' : 'Salvar rascunho'}</button>
                </div>
              </div>
            </>
          )}

          {area === 'visual' && visual && (
            <div className="home-editor-form visual-grid">
              <label>Tema<select value={visual.theme || 'dark'} onChange={(e) => setVisual((current) => ({ ...current, theme: e.target.value }))}><option value="dark">Escuro</option><option value="light">Claro</option></select></label>
              {[
                ['background','Fundo'],['surface','Superfície'],['text','Texto'],['muted','Texto secundário'],['accent','Destaque'],['accent_soft','Destaque suave'],['accent_deep','Destaque profundo']
              ].map(([key,label]) => <label key={key}>{label}<input type="text" value={visual.palette?.[key] || ''} onChange={(e) => setVisual((current) => ({ ...current, palette: { ...(current.palette || {}), [key]: e.target.value } }))} placeholder="#000000" /></label>)}
              <div className="home-editor-inline-settings home-editor-full">Os campos visuais ficam salvos no CMS e aplicados na vitrine publicada</div>
              <div className="home-editor-savebar home-editor-full"><button className="button button-primary" type="button" onClick={() => saveSetting('storefront_visual_defaults', visual)} disabled={saving}>Salvar visual ↗</button></div>
            </div>
          )}

          {area === 'navigation' && navigation && (
            <div className="home-editor-list">
              {(navigation.items || []).map((item,index) => <div className="home-editor-card-row" key={index}><div className="home-editor-card-grid"><label>Nome<input value={item.label || ''} onChange={(e) => setNavigation((current) => ({ ...current, items: current.items.map((x,i) => i === index ? { ...x, label: e.target.value } : x) }))} /></label><label>Link<input value={item.url || ''} onChange={(e) => setNavigation((current) => ({ ...current, items: current.items.map((x,i) => i === index ? { ...x, url: e.target.value } : x) }))} /></label></div><div className="home-editor-row-actions"><button type="button" onClick={() => setNavigation((current) => ({ ...current, items: current.items.filter((_,i) => i !== index) }))}>Excluir</button></div></div>)}
              <button className="text-button" type="button" onClick={() => setNavigation((current) => ({ ...current, items: [...(current.items || []), { label:'Novo item', url:'/shop' }] }))}>+ adicionar item</button>
              <div className="home-editor-savebar"><button className="button button-primary" type="button" onClick={() => saveSetting('navigation', navigation)} disabled={saving}>Salvar menu ↗</button></div>
            </div>
          )}

          {area === 'footer' && footer && <div className="home-editor-form single"><label>Nome<input value={footer.brand || ''} onChange={(e) => setFooter((current) => ({ ...current, brand: e.target.value }))} /></label><label>Localização<input value={footer.location || ''} onChange={(e) => setFooter((current) => ({ ...current, location: e.target.value }))} /></label><label>Ano<input value={footer.year || ''} onChange={(e) => setFooter((current) => ({ ...current, year: e.target.value }))} /></label><div className="home-editor-savebar"><button className="button button-primary" type="button" onClick={() => saveSetting('footer', footer)} disabled={saving}>Salvar rodapé ↗</button></div></div>}

          {area === 'campaign' && campaignDefaults && (
            <div className="home-editor-form">
              <label>Efeito<select value={campaignDefaults.effect} onChange={(e) => setCampaignDefaults((current) => ({ ...current, effect: e.target.value }))}><option value="static">Estático</option><option value="zoom">Zoom</option><option value="pan-horizontal">Pan horizontal</option><option value="pan-vertical">Pan vertical</option><option value="parallax">Parallax</option><option value="ken-burns">Ken Burns</option></select></label>
              <label>Transição<select value={campaignDefaults.transition} onChange={(e) => setCampaignDefaults((current) => ({ ...current, transition: e.target.value }))}><option value="fade">Fade</option><option value="slide">Slide</option><option value="crossfade">Crossfade</option></select></label>
              <label>Velocidade<select value={campaignDefaults.speed} onChange={(e) => setCampaignDefaults((current) => ({ ...current, speed: e.target.value }))}><option value="slow">Lenta</option><option value="normal">Normal</option><option value="fast">Rápida</option></select></label>
              <label>Duração (segundos)<input type="number" min="2" max="30" value={campaignDefaults.duration_seconds} onChange={(e) => setCampaignDefaults((current) => ({ ...current, duration_seconds: Number(e.target.value) }))} /></label>
              <div className="home-editor-savebar home-editor-full"><button className="button button-primary" type="button" onClick={() => saveSetting('campaign_defaults', campaignDefaults)} disabled={saving}>Salvar animações ↗</button></div>
            </div>
          )}
        </section>

        <aside className="home-editor-publish">
          <div className="home-editor-publish-card">
            <span className="eyebrow">PUBLICAÇÃO</span>
            <h3>Rascunho separado da loja publicada</h3>
            <p>Salvar rascunho guarda as alterações no CMS sem mudar o que o cliente vê</p>
            <div className="home-editor-status-flow">
              <span>1. Editar</span>
              <span>2. Salvar rascunho</span>
              <span>3. Visualizar</span>
              <span>4. Publicar</span>
            </div>
            <button className="button button-primary home-editor-publish-button" type="button" onClick={publishAll} disabled={saving}>{saving ? 'Publicando…' : 'Publicar Home'}</button>
          </div>
          {selected && <div className="home-editor-publish-card"><span className="eyebrow">SEÇÃO ATUAL</span><strong>{selectedMeta[0]}</strong><small>{selected.visible ? 'Visível na vitrine' : 'Oculta na vitrine'}</small><small>Ordem {selected.order}</small><small>Atualizado {selected.updated_at ? new Date(selected.updated_at).toLocaleString('pt-BR') : '—'}</small></div>}
          <div className="home-editor-publish-card"><span className="eyebrow">MÍDIA</span><strong>{mediaItems.length}</strong><small>arquivos disponíveis na biblioteca</small></div>
        </aside>
      </div>
    </div>
  )
}

function OnlineOrderModal({ order, onClose, onStatus }) {
  const [status,setStatus]=useState(order.status)
  const [saving,setSaving]=useState(false)
  const statuses=[['RECEIVED','Recebido'],['CONFIRMED','Confirmado'],['PREPARING','Em preparação'],['SHIPPED','Enviado'],['DELIVERED','Entregue'],['CANCELLED','Cancelado']]
  async function save(){setSaving(true);try{await onStatus(order.id,status);onClose()}finally{setSaving(false)}}
  return <div className="modal-backdrop"><div className="modal-panel online-order-modal">
    <div className="modal-header"><div><span className="eyebrow">PEDIDO ONLINE</span><h2>{order.code}</h2></div><button onClick={onClose}>Fechar</button></div>
    <div className="online-order-summary"><div><span>Cliente</span><strong>{order.customer_name}</strong><small>{order.customer_email}{order.customer_phone?' · '+order.customer_phone:''}</small></div><div><span>Total</span><strong>{money(order.total)}</strong><small>{dateBR(order.created_at)}</small></div></div>
    <div className="online-order-payment"><div><span>Pagamento</span><strong>{({PENDING:'Aguardando',APPROVED:'Aprovado',REJECTED:'Recusado',CANCELLED:'Cancelado',REFUNDED:'Estornado'})[order.payment_status]||'Não informado'}</strong><small>{order.payment_provider ? order.payment_provider + (order.payment_method?' · '+order.payment_method:'') : 'Ainda não vinculado'}</small></div><div><span>Venda</span><strong>{order.sale_id ? 'VDA-' + String(order.sale_id).padStart(6,'0') : 'Será criada automaticamente'}</strong></div></div>
    <div className="online-order-address"><span className="eyebrow">ENTREGA</span><p>{order.street}, {order.number}{order.complement?' · '+order.complement:''}<br />{order.neighborhood} · {order.city} / {order.state}<br />CEP {order.postal_code}</p></div>
    <div className="online-order-items"><span className="eyebrow">ITENS</span>{order.items?.map((item)=><div key={item.product_id}><span>{item.quantity} × {item.product_name}</span><strong>{money(item.line_total)}</strong></div>)}</div>
    <label className="online-order-status">Status<select value={status} onChange={(e)=>setStatus(e.target.value)}>{statuses.map(([value,label])=><option key={value} value={value}>{label}</option>)}</select></label>
    <div className="modal-actions"><button className="button button-ghost" type="button" onClick={onClose}>Voltar</button><button className="button button-primary" type="button" disabled={saving||status===order.status} onClick={save}>{saving?'Salvando…':'Salvar status'}</button></div>
  </div></div>
}

function Admin({ user, onLogout }) {
  const initialTab = (() => { try { const requested = new URLSearchParams(window.location.search).get('tab'); return ['dashboard','editor','products','sales','online-orders','finance','recurring','movements','library'].includes(requested) ? requested : 'dashboard' } catch { return 'dashboard' } })()
  const [tab, setTab] = useState(initialTab)
  const [dash, setDash] = useState(null)
  const [products, setProducts] = useState([])
  const [entries, setEntries] = useState([])
  const [categories, setCategories] = useState([])
  const [accounts, setAccounts] = useState([])
  const [recurring, setRecurring] = useState([])
  const [movements, setMovements] = useState([])
  const [sales, setSales] = useState([])
  const [onlineOrders, setOnlineOrders] = useState([])
  const [selectedOnlineOrder, setSelectedOnlineOrder] = useState(null)
  const [loading, setLoading] = useState(true)
  const [modal, setModal] = useState(null)
  const [editingProduct, setEditingProduct] = useState(null)
  const [securityModal, setSecurityModal] = useState(false)

  async function load() {
    setLoading(true)
    try {
      const [d, p, e, c, a, r, m, s, o] = await Promise.all([
        api('/api/admin/dashboard'),
        api('/api/admin/products'),
        api('/api/admin/finance/entries'),
        api('/api/admin/finance/categories'),
        api('/api/admin/finance/accounts'),
        api('/api/admin/finance/recurring'),
        api('/api/admin/stock/movements'),
        api('/api/admin/sales'),
        api('/api/admin/store-orders')
      ])
      setDash(d)
      setProducts(p)
      setEntries(e)
      setCategories(c)
      setAccounts(a)
      setRecurring(r)
      setMovements(m)
      setSales(s)
      setOnlineOrders(Array.isArray(o) ? o : [])
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

  async function removeProduct(product) {
    const confirmed = window.confirm(
      'Excluir o produto "' + product.name + '"? Se ele já tiver histórico de vendas/estoque, o GALEO irá apenas ocultá-lo para preservar o histórico.'
    )
    if (!confirmed) return
    try {
      const result = await api('/api/admin/products/' + product.id, { method: 'DELETE' })
      alert(result?.mode === 'hidden'
        ? 'Produto ocultado. O histórico foi preservado.'
        : 'Produto excluído.')
      await load()
    } catch (error) {
      alert(error.message)
    }
  }

  async function removeFinanceEntry(entry) {
    const confirmed = window.confirm(
      'Excluir o lançamento "' + entry.description + '" no valor de ' + money(entry.amount) + '?'
    )
    if (!confirmed) return
    try {
      await api('/api/admin/finance/entries/' + entry.id, { method: 'DELETE' })
      await load()
    } catch (error) {
      alert(error.message)
    }
  }

  async function updateOnlineOrderStatus(id,status) {
    try {
      await api('/api/admin/store-orders/' + id + '/status', { method:'PATCH', body:{ status } })
      await load()
    } catch(error) { alert(error.message); throw error }
  }

  async function openOnlineOrder(id) {
    try {
      const order=await api('/api/admin/store-orders/' + id)
      setSelectedOnlineOrder(order)
    } catch(error) { alert(error.message) }
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
    editor: 'Editor da loja',
    products: 'Produtos e estoque',
    sales: 'Vendas',
    'online-orders': 'Pedidos online',
    finance: 'Financeiro',
    recurring: 'Contas recorrentes',
    movements: 'Histórico de estoque',
    library: 'Biblioteca de mídia'
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
          ...(user?.role === 'owner' ? [['editor', 'Editor da loja']] : []),
          ['products', 'Produtos e estoque'],
          ['sales', 'Vendas'],
          ['online-orders', 'Pedidos online'],
          ['finance', 'Financeiro'],
          ['recurring', 'Contas recorrentes'],
          ['movements', 'Histórico de estoque'],
          ['library', 'Biblioteca de mídia']
        ].map(([key, label]) => (
          <button className={tab === key ? 'admin-nav active' : 'admin-nav'} onClick={() => setTab(key)} key={key}>{label}</button>
        ))}
        <div className="admin-user"><strong>{user?.email}</strong><small>{user?.role}</small></div>
        <button className="admin-nav" onClick={() => setSecurityModal(true)}>Alterar senha</button>
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
        {!loading && tab === 'editor' && user?.role === 'owner' && <HomeEditor user={user} />}
        {!loading && tab === 'library' && <MediaLibrary api={api} csrf={() => csrfToken} role={user?.role} />}
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
                      <button onClick={() => removeProduct(product)}>Excluir</button>
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

        {!loading && tab === 'online-orders' && (
          <div className="admin-panel">
            <div className="orders-toolbar"><div><span className="eyebrow">LOJA / ONLINE</span><h2>Pedidos recebidos pela vitrine</h2><p>Atualize o andamento de cada pedido sem misturar com as vendas do caixa físico</p></div><strong>{onlineOrders.filter((order)=>order.status!=='CANCELLED' && order.status!=='DELIVERED').length} em andamento</strong></div>
            <table>
              <thead><tr><th>Pedido</th><th>Cliente</th><th>Data</th><th>Itens</th><th>Total</th><th>Status</th><th></th></tr></thead>
              <tbody>
                {onlineOrders.map((order)=><tr key={order.id}><td><strong>{order.code}</strong></td><td><strong>{order.customer_name}</strong><small>{order.customer_email}</small></td><td>{dateBR(order.created_at)}</td><td>{(order.items||[]).reduce((sum,item)=>sum+Number(item.quantity||0),0)}</td><td><strong>{money(order.total)}</strong></td><td><span className={'status-pill status-'+String(order.status).toLowerCase()}>{order.status_label||order.status}</span></td><td className="admin-actions"><button onClick={()=>openOnlineOrder(order.id)}>Abrir</button></td></tr>)}
                {!onlineOrders.length && <tr><td colSpan="7" className="empty-state">Nenhum pedido online recebido ainda</td></tr>}
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
                    <td className="admin-actions">
                      {entry.status === 'PENDENTE' && <button onClick={() => pay(entry.id)}>Marcar pago</button>}
                      {entry.status !== 'CANCELADO' && <button onClick={() => removeFinanceEntry(entry)}>Excluir</button>}
                    </td>
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
      {selectedOnlineOrder && <OnlineOrderModal order={selectedOnlineOrder} onClose={()=>setSelectedOnlineOrder(null)} onStatus={updateOnlineOrderStatus} />}
      {securityModal && <PasswordModal onClose={() => setSecurityModal(false)} onDone={() => setSecurityModal(false)} />}
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
