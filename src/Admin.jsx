import { useEffect, useId, useMemo, useRef, useState } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import ProductSearch from './ProductSearch'
import MediaLibrary from './MediaLibrary'
import { MediaLibraryPicker } from './MediaComparison'
import PointOfSale from './PointOfSale'
import { HomeDraftComparison, HomeSectionOrder, HomeVersionHistory } from './HomeWorkflow'
import HomeCampaignEditor from './HomeCampaignEditor'
import { adminApi as api, clearAdminCsrfToken, getAdminCsrfToken } from './adminApi'
import { directUploadsEnabled, uploadDirectMedia } from './directUpload'
import { activeProductVariants, productHasVariants } from './productVariants'
import './product-variants.css'

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
  if (directUploadsEnabled) {
    const data = await uploadDirectMedia({ api, url: '/api/admin/products/' + productId + '/media', files, onProgress })
    if (!Array.isArray(data?.media)) throw new Error('O servidor não confirmou o envio das imagens.')
    return data
  }

  const batchSize = 8
  const results = []

  for (let start = 0; start < files.length; start += batchSize) {
    const batch = files.slice(start, start + batchSize)
    const formData = new FormData()
    batch.forEach((file) => formData.append('media', file))

    const headers = {}
    const csrfToken = getAdminCsrfToken()
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
      if (response.status === 401 || data?.code === 'ADMIN_OWNER_REQUIRED') {
        window.dispatchEvent(new Event('galeo-admin-auth-required'))
      }
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
  image_asset_id: null,
  image_variant: null,
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

const inventoryFormValue = (enabled, variants, stock) => JSON.stringify({
  enabled: Boolean(enabled),
  stock: enabled ? null : Number(stock || 0),
  variants: enabled ? variants.map(row => ({
    id: Number(row.id) || null, size: String(row.size || '').trim().replace(/\s+/g, ' ').toLocaleUpperCase('pt-BR'),
    stock: Number(row.stock || 0), active: row.active !== false && Number(row.active ?? 1) !== 0
  })) : []
})

function ProductForm({ product, categories, onClose, onDone }) {
  const [savedProductId, setSavedProductId] = useState(Number(product?.id || 0))
  const editing = Boolean(savedProductId)
  const [form, setForm] = useState(product ? {
    ...product,
    image: product.image || '',
    video: product.video || '',
    image_asset_id: null,
    image_variant: null,
    category_id: product.category_id || '',
    active: Boolean(product.active)
  } : emptyProduct)
  const [media, setMedia] = useState([])
  const [sizesEnabled, setSizesEnabled] = useState(() => productHasVariants(product))
  const [savedHasSizes, setSavedHasSizes] = useState(() => productHasVariants(product))
  const [variantRows, setVariantRows] = useState(() => (product?.variants || []).map(variant => ({ ...variant, _key: 'saved-' + variant.id, active: variant.active !== false && Number(variant.active ?? 1) !== 0 })))
  const [imageFiles, setImageFiles] = useState([])
  const [videoFiles, setVideoFiles] = useState([])
  const [uploadProgress, setUploadProgress] = useState({ done: 0, total: 0 })
  const [saving, setSaving] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [mediaError, setMediaError] = useState('')
  const [inventoryConflict, setInventoryConflict] = useState(false)
  const [refreshingInventory, setRefreshingInventory] = useState(false)
  const [inventoryNotice, setInventoryNotice] = useState('')
  const [libraryOpen, setLibraryOpen] = useState(false)
  const [coverFailedUrl, setCoverFailedUrl] = useState('')
  const libraryTrigger = useRef(null)
  const manualImagePending = useRef(false)
  const manualVideoPending = useRef(false)
  const titleId = useId()
  const inventoryBaseline = useRef({
    value: inventoryFormValue(productHasVariants(product), product?.variants || [], product?.stock),
    token: product?.inventory_token
  })
  const set = (key, value) => setForm((current) => ({ ...current, [key]: value }))
  const variantsStock = variantRows.filter(variant => variant.active).reduce((sum, variant) => sum + Math.max(0, Number(variant.stock) || 0), 0)

  function rememberInventory(saved) {
    const enabled = productHasVariants(saved)
    const rows = (saved.variants || []).map(variant => ({ ...variant, _key: 'saved-' + variant.id, active: variant.active !== false && Number(variant.active ?? 1) !== 0 }))
    inventoryBaseline.current = { value: inventoryFormValue(enabled, rows, saved.stock), token: saved.inventory_token }
    setForm(current => ({ ...current, stock: Number(saved.stock || 0) }))
    setSizesEnabled(enabled)
    setSavedHasSizes(enabled)
    setVariantRows(rows)
    setInventoryConflict(false)
  }

  async function refreshInventory() {
    setRefreshingInventory(true)
    try {
      const products = await api('/api/admin/products')
      const saved = products.find(item => Number(item.id) === savedProductId)
      if (!saved) throw new Error('O produto não está mais disponível. Feche o formulário e atualize a lista.')
      rememberInventory(saved)
      setMediaError('')
      setInventoryNotice('Quantidades atualizadas. Confira o estoque antes de salvar; os demais campos que você editou foram mantidos.')
    } catch (error) { setMediaError(error.message) }
    finally { setRefreshingInventory(false) }
  }

  function addSize() {
    setVariantRows(rows => [...rows, { _key: crypto.randomUUID(), size: '', stock: 0, active: true }])
  }

  function toggleSizes(enabled) {
    setSizesEnabled(enabled)
    if (enabled && !variantRows.length) addSize()
  }

  function changeSize(key, field, value) {
    setVariantRows(rows => rows.map(row => row._key === key ? { ...row, [field]: value } : row))
  }

  function removeSize(row) {
    if (row.id && Number(row.stock) > 0) {
      setMediaError('Zere o estoque desse tamanho antes de desativá-lo.')
      return
    }
    setVariantRows(rows => row.id ? rows.map(item => item._key === row._key ? { ...item, active: false, stock: 0 } : item) : rows.filter(item => item._key !== row._key))
  }

  function closeLibrary() {
    setLibraryOpen(false)
    window.requestAnimationFrame(() => libraryTrigger.current?.focus({ preventScroll:true }))
  }

  function chooseLibraryImage(item) {
    setForm((current) => ({ ...current, image: item.url, image_asset_id: item.id, image_variant: item.variant }))
    setCoverFailedUrl('')
    closeLibrary()
  }

  function setManualImage(url) {
    manualImagePending.current = true
    setForm((current) => ({ ...current, image: url, image_asset_id: null, image_variant: null }))
    setCoverFailedUrl('')
  }

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

  async function loadMedia(productId, syncUploadedCover = false) {
    if (!productId) return setMedia([])
    try {
      const data = await api('/api/admin/products/' + productId + '/media')
      const uploaded = Array.isArray(data) ? data : []
      setMedia(uploaded)
      if (syncUploadedCover) {
        const products = await api('/api/admin/products')
        const savedProduct = Array.isArray(products) ? products.find((item) => Number(item.id) === Number(productId)) : null
        if (savedProduct) setForm((current) => ({
          ...current,
          image: current.image || (manualImagePending.current ? '' : savedProduct.image) || '',
          video: current.video || (manualVideoPending.current ? '' : savedProduct.video) || ''
        }))
      }
    } catch (error) {
      setMediaError(error.message)
    }
  }

  useEffect(() => {
    if (savedProductId) loadMedia(savedProductId)
  }, [savedProductId])

  async function removeMedia(item) {
    if (!window.confirm('Excluir esta mídia do produto?')) return
    try {
      await api('/api/admin/products/' + item.product_id + '/media/' + item.id, { method: 'DELETE' })
      setForm(current => ({...current, image: !manualImagePending.current && current.image === item.url ? '' : current.image, video: !manualVideoPending.current && current.video === item.url ? '' : current.video}))
      await loadMedia(item.product_id, true)
    } catch (error) {
      alert(error.message)
    }
  }

  async function enviarMidiaAtual() {
    const files = [...imageFiles, ...videoFiles]
    if (!savedProductId || !files.length) return

    setUploading(true)
    setMediaError('')
    setUploadProgress({ done: 0, total: files.length })

    try {
      await uploadMedia(savedProductId, files, (done, total) => {
        setUploadProgress({ done, total })
        const completed = new Set(files.slice(0, done))
        setImageFiles(current => current.filter(file => !completed.has(file)))
        setVideoFiles(current => current.filter(file => !completed.has(file)))
      })
      setImageFiles([])
      setVideoFiles([])
      await loadMedia(savedProductId, true)
    } catch (error) {
      await loadMedia(savedProductId, true)
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
    setInventoryNotice('')

    try {
      const inventoryChanged = !editing || inventoryFormValue(sizesEnabled, variantRows, form.stock) !== inventoryBaseline.current.value
      if (inventoryChanged && sizesEnabled && (!variantRows.some(row => row.active) || variantRows.some(row => !String(row.size || '').trim()))) throw new Error('Preencha os tamanhos da grade antes de salvar.')
      const body = {
        ...form,
        image_asset_id: Number(form.image_asset_id) || null,
        image_variant: Number(form.image_asset_id) ? form.image_variant : null,
        price: Number(form.price || 0), cost: Number(form.cost || 0),
        min_stock: Number(form.min_stock || 0), category_id: Number(form.category_id) || null
      }
      // A product may sell while this form stays open. Editing text or media
      // must never replay an old stock balance from the form's initial load.
      delete body.stock
      delete body.variants
      delete body.inventory_token
      if (inventoryChanged) {
        body.stock = sizesEnabled ? variantsStock : Number(form.stock || 0)
        if (sizesEnabled || savedHasSizes) body.variants = sizesEnabled ? variantRows.map(row => ({ ...(row.id ? { id: Number(row.id) } : {}), size: String(row.size || '').trim(), stock: Number(row.stock || 0), active: row.active })) : []
        if (editing && inventoryBaseline.current.token) body.inventory_token = inventoryBaseline.current.token
      }
      const saved = await api(editing ? '/api/admin/products/' + savedProductId : '/api/admin/products', {
        method: editing ? 'PUT' : 'POST',
        body
      })

      const productId = Number(saved?.id || savedProductId)
      if (!productId) throw new Error('O servidor não confirmou o cadastro do produto.')
      setSavedProductId(productId)
      rememberInventory(saved)
      manualImagePending.current = false
      manualVideoPending.current = false
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
        const completed = new Set(files.slice(0, done))
        setImageFiles(current => current.filter(file => !completed.has(file)))
        setVideoFiles(current => current.filter(file => !completed.has(file)))
          })
          setImageFiles([])
          setVideoFiles([])
          await loadMedia(productId, true)
        } catch (error) {
          await loadMedia(productId, true)
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
      if (error.code === 'INVENTORY_CHANGED') setInventoryConflict(true)
      setSaving(false)
    } finally {
      setSaving(false)
      setUploading(false)
    }
  }

  return (
    <div className="modal-backdrop product-modal-backdrop">
      <form className="admin-modal admin-modal-wide" onSubmit={submit} role="dialog" aria-modal="true" aria-labelledby={titleId}>
        <button type="button" className="modal-close" aria-label="Fechar formulário do produto" onClick={onClose}>×</button>
        <h2 id={titleId}>{editing ? 'Editar produto' : 'Cadastrar produto'}</h2>

        <div className="admin-form-grid">
          <label>Nome<input value={form.name} onChange={(e) => set('name', e.target.value)} required /></label>
          <label>Marca<input value={form.brand} onChange={(e) => set('brand', e.target.value)} placeholder="Ex.: Nike, Adidas…" /></label>
          <label>Categoria<select value={form.category_id} onChange={(e) => set('category_id', e.target.value)}><option value="">Sem categoria</option>{categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
          <label>Preço de venda<input type="number" min="0" step="0.01" value={form.price} onChange={(e) => set('price', e.target.value)} required={form.active} /></label>
          <label>Custo<input type="number" min="0" step="0.01" value={form.cost} onChange={(e) => set('cost', e.target.value)} /></label>
          <label>{sizesEnabled ? 'Estoque total dos tamanhos' : 'Estoque inicial / atual'}<input type="number" min="0" step="1" value={sizesEnabled ? variantsStock : form.stock} onChange={(e) => set('stock', e.target.value)} readOnly={sizesEnabled} required /></label>
          <label>Estoque mínimo<input type="number" min="0" step="1" value={form.min_stock} onChange={(e) => set('min_stock', e.target.value)} /></label>
          <label>Status<select value={form.active ? '1' : '0'} onChange={(e) => set('active', e.target.value === '1')}><option value="1">Ativo no site</option><option value="0">Rascunho — fora do catálogo</option></select></label>
        </div>

        {!form.active && <p className="page-note">Este rascunho fica somente no Admin. Complete os dados e altere o status para Ativo no site quando estiver pronto para vender.</p>}

        <section className="product-size-admin" aria-label="Estoque por tamanho">
          <label><input type="checkbox" checked={sizesEnabled} onChange={event => toggleSizes(event.target.checked)} />Controlar estoque por tamanho</label>
          {sizesEnabled && <><p>Informe os tamanhos ou as numerações e a quantidade real de cada um.</p><div className="product-size-rows">{variantRows.map((row, index) => <div key={row._key} className={'product-size-row' + (row.active ? '' : ' is-inactive')}>
            <label>Tamanho<input value={row.size} onChange={event => changeSize(row._key, 'size', event.target.value)} maxLength="40" required disabled={!row.active} aria-label={'Tamanho ' + (index + 1)} placeholder="Ex.: M ou 40" /></label>
            <label>Quantidade<input type="number" min="0" step="1" value={row.stock} onChange={event => changeSize(row._key, 'stock', event.target.value)} required disabled={!row.active} aria-label={'Quantidade do tamanho ' + (index + 1)} /></label>
            {row.active ? <button type="button" onClick={() => removeSize(row)}>{row.id ? 'Desativar tamanho' : 'Remover tamanho'}</button> : <button type="button" onClick={() => changeSize(row._key, 'active', true)}>Reativar tamanho</button>}
          </div>)}</div><button type="button" className="button button-ghost" onClick={addSize}>Adicionar tamanho</button><strong className="product-size-total">Total: {variantsStock} unidade{variantsStock === 1 ? '' : 's'}</strong></>}
        </section>

        <label>Descrição<textarea value={form.description} onChange={(e) => set('description', e.target.value)} rows="4" placeholder="Descrição, composição, medidas, cuidados…" /></label>

        <section className="product-cover-selection" aria-label="Capa do produto">
          <div className="product-cover-preview media-checkerboard" data-testid="product-cover-preview">
            {form.image ? <>
              <img key={form.image} src={form.image} alt="Capa atual do produto" onLoad={() => setCoverFailedUrl('')} onError={() => setCoverFailedUrl(form.image)} />
              {coverFailedUrl === form.image && <p className="media-preview-state" role="status">Não foi possível carregar a capa atual.</p>}
            </> : <p className="media-preview-state">Nenhuma capa selecionada.</p>}
          </div>
          <div className="product-cover-details">
            <h3>Capa atual</h3>
            <p>Escolha uma foto e compare as versões Original e Sem fundo antes de aplicar.</p>
            {form.image_asset_id && <p className="media-cover-status" role="status">Capa selecionada: {form.image_variant === 'galeo' ? 'Fundo GALEO' : form.image_variant === 'ai' ? 'Sem fundo' : 'Original'}. Salve o produto para aplicar.</p>}
            <button type="button" className="button button-ghost" ref={libraryTrigger} aria-expanded={libraryOpen} disabled={saving || uploading} onClick={() => setLibraryOpen((open) => !open)}>Escolher da biblioteca</button>
          </div>
        </section>

        {libraryOpen && <MediaLibraryPicker api={api} currentUrl={form.image} disabled={saving || uploading} onChoose={chooseLibraryImage} onCancel={closeLibrary} />}

        <div className="admin-form-grid">
          <label>URL da foto principal<input value={form.image} disabled={saving || uploading} onChange={(e) => setManualImage(e.target.value)} placeholder="https://..." /></label>
          <label>URL do vídeo<input value={form.video} disabled={saving || uploading} onChange={(e) => { manualVideoPending.current = true; set('video', e.target.value) }} placeholder="https://..." /></label>
        </div>

        <div className="admin-media-upload">
          <div>
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

        {inventoryNotice && <p className="admin-media-note" role="status">{inventoryNotice}</p>}
        {mediaError && (
          <div className="admin-media-note admin-media-error" role="alert">
            {mediaError}
            {inventoryConflict && <button type="button" disabled={saving || refreshingInventory} onClick={refreshInventory}>{refreshingInventory ? 'Atualizando quantidades…' : 'Atualizar quantidades'}</button>}
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
            <h3>Galeria do produto</h3>
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

        <button className="button button-primary" disabled={saving || uploading || refreshingInventory}>
          {uploading ? 'Enviando mídia…' : saving ? 'Salvando…' : 'Salvar produto'}
        </button>
      </form>
    </div>
  )
}

function StockModal({ products, onClose, onDone }) {
  const [form, setForm] = useState({ product_id: '', variant_id: '', type: 'ENTRADA', quantity: '', reason: '' })
  const [saving, setSaving] = useState(false)
  const set = (k, v) => setForm((c) => ({ ...c, [k]: v }))
  const selectedProduct = products.find(product => Number(product.id) === Number(form.product_id))
  const stockVariants = activeProductVariants(selectedProduct)

  async function submit(event) {
    event.preventDefault()
    setSaving(true)
    try {
      await api('/api/admin/stock', {
        method: 'POST',
        body: {
          ...form,
          product_id: Number(form.product_id),
          ...(productHasVariants(selectedProduct) ? { variant_id: Number(form.variant_id) } : {}),
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
        <h2>Movimentar estoque</h2>
        <ProductSearch products={products} value={form.product_id} onChange={value => setForm(current => ({ ...current, product_id: value, variant_id: '' }))} required />
        {productHasVariants(selectedProduct) && <label>Tamanho<select aria-label="Tamanho" value={form.variant_id} onChange={event => set('variant_id', event.target.value)} required><option value="">Escolha o tamanho</option>{stockVariants.map(variant => <option value={variant.id} key={variant.id}>{variant.size} — {variant.stock} un.</option>)}</select></label>}
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

const todayBR = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date())

function FinanceModal({ onClose, onDone }) {
  const [form, setForm] = useState({ description: '', amount: '', date: todayBR() })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const set = (k, v) => setForm((c) => ({ ...c, [k]: v }))

  async function submit(event) {
    event.preventDefault()
    setSaving(true)
    setError('')
    try {
      await api('/api/admin/expenses', {
        method: 'POST',
        body: { ...form, amount: Number(form.amount) }
      })
      onDone()
    } catch (error) {
      setError(error.message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="modal-backdrop">
      <form className="admin-modal" onSubmit={submit} role="dialog" aria-modal="true" aria-labelledby="expense-title">
        <button type="button" className="modal-close" aria-label="Fechar gasto" onClick={onClose}>×</button>
        <h2 id="expense-title">Registrar gasto</h2>
        <label>Descrição do gasto<input value={form.description} onChange={(e) => set('description', e.target.value)} placeholder="Ex.: Embalagens, energia, aluguel" required /></label>
        <label>Valor gasto<input type="number" min="0.01" step="0.01" value={form.amount} onChange={(e) => set('amount', e.target.value)} required /></label>
        <label>Data do gasto<input type="date" value={form.date} max={todayBR()} onChange={(e) => set('date', e.target.value)} required /></label>
        {error && <p className="form-error" role="alert">{error}</p>}
        <button className="button button-primary" disabled={saving}>{saving ? 'Salvando…' : 'Salvar gasto'}</button>
      </form>
    </div>
  )
}

function RecurringModal({ onClose, onDone }) {
  const [form, setForm] = useState({ description: '', amount: '', due_day: 10 })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const set = (k, v) => setForm((c) => ({ ...c, [k]: v }))

  async function submit(event) {
    event.preventDefault()
    setSaving(true)
    setError('')
    try {
      await api('/api/admin/finance/recurring', {
        method: 'POST',
        body: {
          ...form,
          amount: Number(form.amount),
          due_day: Number(form.due_day)
        }
      })
      onDone()
    } catch (error) {
      setError(error.message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="modal-backdrop">
      <form className="admin-modal" onSubmit={submit} role="dialog" aria-modal="true" aria-labelledby="recurring-title">
        <button type="button" className="modal-close" aria-label="Fechar gasto recorrente" onClick={onClose}>×</button>
        <h2 id="recurring-title">Novo gasto recorrente</h2>
        <label>Descrição do gasto<input value={form.description} onChange={(e) => set('description', e.target.value)} placeholder="Ex.: Aluguel" required /></label>
        <label>Valor mensal<input type="number" min="0.01" step="0.01" value={form.amount} onChange={(e) => set('amount', e.target.value)} required /></label>
        <label>Dia habitual do gasto<input type="number" min="1" max="31" value={form.due_day} onChange={(e) => set('due_day', e.target.value)} required /></label>
        {error && <p className="form-error" role="alert">{error}</p>}
        <button className="button button-primary" disabled={saving}>{saving ? 'Salvando…' : 'Salvar gasto recorrente'}</button>
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
  const [settingRecords, setSettingRecords] = useState({})
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
  const [historyRefresh, setHistoryRefresh] = useState(0)
  const operationPending = useRef(false)

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
    setSettingRecords(Object.fromEntries((settingsData?.settings || []).map((item) => [item.key, item])))
    setSettings(nextSettings)
    setVisual(nextSettings.storefront_visual_defaults || null)
    setNavigation(nextSettings.navigation || { items: [] })
    setFooter(nextSettings.footer || { brand: 'GALEO STORE', year: '2026' })
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
  }, [selectedKey])

  function setField(key, value) {
    setDraft((current) => {
      const next = { ...(current || {}), [key]: value }
      if (key.endsWith('_media_url') && value !== current?.[key]) next[key.replace(/_url$/, '_id')] = null
      return next
    })
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
    if (!draft || operationPending.current) return
    operationPending.current = true
    setSaving(true)
    setStatus('')
    try {
      await api('/api/admin/home/' + selectedKey, { method: 'PUT', body: { content: draft, visible, order } })
      await loadHome()
      setStatus('Rascunho salvo')
    } catch (error) {
      setStatus(error.message)
    } finally { setSaving(false); operationPending.current = false }
  }

  async function publishAll() {
    if (operationPending.current || hasUnsavedChanges) return
    operationPending.current = true
    setSaving(true)
    setStatus('')
    try {
      await api('/api/admin/home/publish', { method: 'POST' })
      await loadHome()
      setHistoryRefresh((current) => current + 1)
      setStatus('Home publicada')
    } catch (error) {
      setStatus(error.message)
    } finally { setSaving(false); operationPending.current = false }
  }

  async function saveSetting(key, value) {
    if (operationPending.current) return
    operationPending.current = true
    setSaving(true)
    setStatus('')
    try {
      await api('/api/admin/home/settings/' + key, { method: 'PUT', body: { value } })
      await loadHome()
      setStatus('Configuração salva no rascunho. Visualize antes de publicar a Home.')
    } catch (error) {
      setStatus(error.message)
    } finally { setSaving(false); operationPending.current = false }
  }

  async function reorderSections(keys) {
    if (operationPending.current) return
    operationPending.current = true
    setSaving(true)
    try {
      await api('/api/admin/home/order', { method:'PUT', body:{ keys } })
      setSections((current) => keys.map((key, index) => ({ ...current.find((section) => section.key === key), order:(index + 1) * 10 })))
      setOrder((keys.indexOf(selectedKey) + 1) * 10)
      setStatus('Ordem salva no rascunho. Publique a Home para aplicar na loja.')
    } catch (error) {
      setStatus(error.message)
      throw error
    } finally { setSaving(false); operationPending.current = false }
  }

  async function restoreHome(result) {
    await loadHome()
    setStatus('Versão ' + result.restored_from.version + ' restaurada no rascunho. Confira a prévia antes de publicar.')
  }

  function mediaOptions(type) { return mediaItems.filter((item) => !type || item.media_type === type) }
  function applyMedia(prefix, item) {
    setDraft((current) => ({ ...(current || {}), [prefix + '_media_id']: item ? Number(item.id) : null, [prefix + '_media_url']: item?.url || '' }))
  }

  const selected = sections.find((section) => section.key === selectedKey)
  const selectedMeta = HOME_EDITOR_META[selectedKey] || [selectedKey, 'Conteúdo da seção']
  const featuredIds = Array.isArray(draft?.product_ids) ? draft.product_ids.map(Number) : []
  const changed = (left, right) => JSON.stringify(left || {}) !== JSON.stringify(right || {})
  const sectionUnsaved = selected && (changed(draft, selected.draft) || visible !== Boolean(selected.visible) || Number(order) !== Number(selected.order))
  const settingKeys = { visual:'storefront_visual_defaults', navigation:'navigation', footer:'footer', campaign:'campaign_defaults' }
  const settingValues = { visual, navigation, footer, campaign:campaignDefaults }
  const settingUnsaved = Object.keys(settingKeys).some((key) => settingValues[key] && settings[settingKeys[key]] && changed(settingValues[key], settings[settingKeys[key]]))
  const hasUnsavedChanges = Boolean(sectionUnsaved || settingUnsaved)

  if (user?.role !== 'owner') return <div className="admin-panel empty-state">O editor da loja é exclusivo do proprietário</div>

  return (
    <div className="home-editor">
      <div className="home-editor-main">
        <aside className="home-editor-sidebar">
          <div className="home-editor-sidebar-title"><strong>Conteúdo da Home</strong><small>Você está editando um rascunho</small></div>
          <HomeSectionOrder sections={sections} meta={HOME_EDITOR_META} selectedKey={selectedKey} active={area === 'content'} disabled={saving} onSelect={(key) => { setArea('content'); setSelectedKey(key) }} onReorder={reorderSections} />
          <div className="home-editor-divider" />
          <strong className="home-editor-nav-label">Configurações</strong>
          {[['visual','Visual'],['navigation','Menu principal'],['footer','Rodapé'],['campaign','Animações']].map(([key,label]) => (
            <button type="button" key={key} className={area === key ? 'home-editor-nav active' : 'home-editor-nav'} onClick={() => setArea(key)}>
              <span>{label}</span><small>Editar</small>
            </button>
          ))}
        </aside>

        <section className="home-editor-workspace">
          <div className="home-editor-heading">
            <div>
              <h2>{area === 'content' ? selectedMeta[0] : ({ visual: 'Visual da loja', navigation: 'Menu principal', footer: 'Rodapé', campaign: 'Animações das campanhas' }[area] || 'Editor')}</h2>
              <p>{area === 'content' ? selectedMeta[1] : 'Configurações aplicadas à experiência pública da GALEO'}</p>
            </div>
            {status && <span className="home-editor-status" role="status">{status}</span>}
          </div>

          {area === 'content' && draft && (
            <>
              <div className="home-editor-section-toolbar">
                <label>Visibilidade<select value={visible ? '1' : '0'} onChange={(event) => setVisible(event.target.value === '1')}><option value="1">Visível</option><option value="0">Oculta</option></select></label>
                <label>Ordem<input type="number" min="0" max="999" value={order} onChange={(event) => setOrder(Number(event.target.value))} /></label>
              </div>
              <HomeDraftComparison section={selected} title={selectedMeta[0]} products={products} mediaItems={mediaItems} unsaved={sectionUnsaved} />

              {selectedKey === 'hero' && (
                <div className="home-editor-form">
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
                <HomeCampaignEditor draft={draft} mediaItems={mediaItems} defaults={campaignDefaults}
                  onChange={(index, item) => setArrayItem('items', index, item)} onRemove={(index) => removeArrayItem('items', index)} onMove={(index, direction) => moveArrayItem('items', index, direction)}
                  onAdd={() => addArrayItem('items', { title:'Nova campanha', button_label:'Explorar', button_url:'/shop', animation:{ use_default:true }, slides:[{ media_url:'', media_type:'image', mobile_media_url:'' }] })} />
              )}

              {selectedKey === 'manifesto' && <div className="home-editor-form single"><label>Texto<textarea rows="6" value={draft.text || ''} onChange={(e) => setField('text', e.target.value)} /></label></div>}
              {selectedKey === 'newsletter' && <div className="home-editor-form single"><label>Título<input value={draft.title || ''} onChange={(e) => setField('title', e.target.value)} /></label><label>Texto do botão<input value={draft.button_label || ''} onChange={(e) => setField('button_label', e.target.value)} /></label></div>}

              <div className="home-editor-savebar">
                <div className="home-editor-save-status">
                  <strong>{sectionUnsaved ? 'Alterações ainda não salvas' : 'Último rascunho salvo'}</strong>
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

          {area !== 'content' && settingRecords[settingKeys[area]] && <HomeDraftComparison setting={settingRecords[settingKeys[area]]} title={{visual:'Visual da loja',navigation:'Menu principal',footer:'Rodapé',campaign:'Animações'}[area]} unsaved={changed(settingValues[area], settings[settingKeys[area]])} mediaItems={mediaItems} />}

          {area === 'visual' && visual && (
            <div className="home-editor-form visual-grid">
              <label>Tema<select value={visual.theme || 'dark'} onChange={(e) => setVisual((current) => ({ ...current, theme: e.target.value }))}><option value="dark">Escuro</option><option value="light">Claro</option></select></label>
              {[
                ['background','Fundo'],['surface','Superfície'],['text','Texto'],['muted','Texto secundário'],['accent','Destaque'],['accent_soft','Destaque suave'],['accent_deep','Destaque profundo']
              ].map(([key,label]) => <label key={key}>{label}<input type="text" value={visual.palette?.[key] || ''} onChange={(e) => setVisual((current) => ({ ...current, palette: { ...(current.palette || {}), [key]: e.target.value } }))} placeholder="#000000" /></label>)}
              <div className="home-editor-inline-settings home-editor-full">Os campos visuais ficam salvos no CMS e aplicados na vitrine publicada</div>
              <div className="home-editor-savebar home-editor-full"><button className="button button-primary" type="button" onClick={() => saveSetting('storefront_visual_defaults', visual)} disabled={saving}>Salvar visual no rascunho ↗</button></div>
            </div>
          )}

          {area === 'navigation' && navigation && (
            <div className="home-editor-list">
              {(navigation.items || []).map((item,index) => <div className="home-editor-card-row" key={index}><div className="home-editor-card-grid"><label>Nome<input value={item.label || ''} onChange={(e) => setNavigation((current) => ({ ...current, items: current.items.map((x,i) => i === index ? { ...x, label: e.target.value } : x) }))} /></label><label>Link<input value={item.url || ''} onChange={(e) => setNavigation((current) => ({ ...current, items: current.items.map((x,i) => i === index ? { ...x, url: e.target.value } : x) }))} /></label></div><div className="home-editor-row-actions"><button type="button" onClick={() => setNavigation((current) => ({ ...current, items: current.items.filter((_,i) => i !== index) }))}>Excluir</button></div></div>)}
              <button className="text-button" type="button" onClick={() => setNavigation((current) => ({ ...current, items: [...(current.items || []), { label:'Novo item', url:'/shop' }] }))}>+ adicionar item</button>
              <div className="home-editor-savebar"><button className="button button-primary" type="button" onClick={() => saveSetting('navigation', navigation)} disabled={saving}>Salvar menu no rascunho ↗</button></div>
            </div>
          )}

          {area === 'footer' && footer && <div className="home-editor-form single"><label>Nome<input value={footer.brand || ''} onChange={(e) => setFooter((current) => ({ ...current, brand: e.target.value }))} /></label><label>Ano<input value={footer.year || ''} onChange={(e) => setFooter((current) => ({ ...current, year: e.target.value }))} /></label><div className="home-editor-savebar"><button className="button button-primary" type="button" onClick={() => saveSetting('footer', footer)} disabled={saving}>Salvar rodapé no rascunho ↗</button></div></div>}

          {area === 'campaign' && campaignDefaults && (
            <div className="home-editor-form">
              <label>Efeito<select value={campaignDefaults.effect} onChange={(e) => setCampaignDefaults((current) => ({ ...current, effect: e.target.value }))}><option value="static">Estático</option><option value="zoom">Zoom</option><option value="pan-horizontal">Pan horizontal</option><option value="pan-vertical">Pan vertical</option><option value="parallax">Parallax</option><option value="ken-burns">Ken Burns</option></select></label>
              <label>Transição<select value={campaignDefaults.transition} onChange={(e) => setCampaignDefaults((current) => ({ ...current, transition: e.target.value }))}><option value="fade">Fade</option><option value="slide">Slide</option><option value="crossfade">Crossfade</option></select></label>
              <label>Velocidade<select value={campaignDefaults.speed} onChange={(e) => setCampaignDefaults((current) => ({ ...current, speed: e.target.value }))}><option value="slow">Lenta</option><option value="normal">Normal</option><option value="fast">Rápida</option></select></label>
              <label>Duração (segundos)<input type="number" min="2" max="30" value={campaignDefaults.duration_seconds} onChange={(e) => setCampaignDefaults((current) => ({ ...current, duration_seconds: Number(e.target.value) }))} /></label>
              <div className="home-editor-savebar home-editor-full"><button className="button button-primary" type="button" onClick={() => saveSetting('campaign_defaults', campaignDefaults)} disabled={saving}>Salvar animações no rascunho ↗</button></div>
            </div>
          )}
        </section>

        <aside className="home-editor-publish">
          <div className="home-editor-publish-card">
            <h3>Rascunho separado da loja publicada</h3>
            <p>Salvar rascunho guarda as alterações no CMS sem mudar o que o cliente vê</p>
            <div className="home-editor-status-flow">
              <span>1. Editar</span>
              <span>2. Salvar rascunho</span>
              <span>3. Visualizar</span>
              <span>4. Publicar</span>
            </div>
            {hasUnsavedChanges && <p>Salve suas alterações antes de publicar. A prévia mostra o último rascunho salvo.</p>}
            <button className="button button-primary home-editor-publish-button" type="button" onClick={publishAll} disabled={saving || hasUnsavedChanges}>{saving ? 'Publicando…' : 'Publicar Home'}</button>
          </div>
          {selected && <div className="home-editor-publish-card"><strong>{selectedMeta[0]}</strong><small>{selected.visible ? 'Visível no rascunho' : 'Oculta no rascunho'}</small><small>Ordem {selected.order}</small><small>Atualizado {selected.updated_at ? new Date(selected.updated_at).toLocaleString('pt-BR') : '—'}</small></div>}
          <HomeVersionHistory api={api} disabled={saving || hasUnsavedChanges} refreshKey={historyRefresh} onRestore={restoreHome} onBusy={(busy) => { operationPending.current = busy; setSaving(busy) }} />
          <div className="home-editor-publish-card"><strong>{mediaItems.length}</strong><small>arquivos disponíveis na biblioteca</small></div>
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
    <div className="modal-header"><div><h2>{order.code}</h2></div><button onClick={onClose}>Fechar</button></div>
    <div className="online-order-summary"><div><span>Cliente</span><strong>{order.customer_name}</strong><small>{order.customer_email}{order.customer_phone?' · '+order.customer_phone:''}</small></div><div><span>Total</span><strong>{money(order.total)}</strong><small>{dateBR(order.created_at)}</small></div></div>
    <div className="online-order-payment"><div><span>Pagamento</span><strong>{({PENDING:'Aguardando',APPROVED:'Aprovado',REJECTED:'Recusado',CANCELLED:'Cancelado',REFUNDED:'Estornado'})[order.payment_status]||'Não informado'}</strong><small>{order.payment_provider ? order.payment_provider + (order.payment_method?' · '+order.payment_method:'') : 'Ainda não vinculado'}</small></div><div><span>Venda</span><strong>{order.sale_id ? 'VDA-' + String(order.sale_id).padStart(6,'0') : 'Será criada automaticamente'}</strong></div></div>
    <div className="online-order-address"><h3>Entrega</h3><p>{order.street}, {order.number}{order.complement?' · '+order.complement:''}<br />{order.neighborhood} · {order.city} / {order.state}<br />CEP {order.postal_code}</p></div>
    <div className="online-order-items"><h3>Itens</h3>{order.items?.map((item,index)=><div key={item.id ?? index}><span>{item.quantity} × {item.product_name}{item.size_label && ' — tamanho ' + item.size_label}</span><strong>{money(item.line_total)}</strong></div>)}</div>
    <label className="online-order-status">Status<select value={status} onChange={(e)=>setStatus(e.target.value)}>{statuses.map(([value,label])=><option key={value} value={value}>{label}</option>)}</select></label>
    <div className="modal-actions"><button className="button button-ghost" type="button" onClick={onClose}>Voltar</button><button className="button button-primary" type="button" disabled={saving||status===order.status} onClick={save}>{saving?'Salvando…':'Salvar status'}</button></div>
  </div></div>
}

function VisualEditorLaunch() {
  return (
    <section className="visual-editor-launch">
      <h2>Edite na própria loja</h2>
      <p>Abra o rascunho e clique no texto ou na imagem que deseja mudar. Você verá as alterações na página enquanto edita.</p>
      <ol className="visual-editor-launch-steps">
        <li>Clique em um texto, imagem ou seção para editar.</li>
        <li>Salve o rascunho e confira como ficará para o cliente.</li>
        <li>Publique quando estiver tudo pronto.</li>
      </ol>
      <div className="visual-editor-launch-actions">
        <Link className="button button-primary" to="/?preview=draft&edit=1">Editar rascunho ↗</Link>
        <a className="button button-ghost" href="/admin?tab=editor&mode=advanced">Configurações avançadas</a>
      </div>
      <p>Salvar o rascunho não altera a loja pública. As mudanças só aparecem para os clientes depois de publicar.</p>
    </section>
  )
}

function Admin({ user, onLogout }) {
  const location = useLocation()
  const navigate = useNavigate()
  const requestedTab = new URLSearchParams(location.search).get('tab')
  const tab = requestedTab === 'movements' ? 'products' : ['dashboard','editor','products','pdv','sales','online-orders','finance','recurring','library'].includes(requestedTab) ? requestedTab : 'dashboard'
  const advancedEditor = new URLSearchParams(location.search).get('mode') === 'advanced'
  const [dash, setDash] = useState(null)
  const [products, setProducts] = useState([])
  const [entries, setEntries] = useState([])
  const [productCategories, setProductCategories] = useState([])
  const [recurring, setRecurring] = useState([])
  const [sales, setSales] = useState([])
  const [onlineOrders, setOnlineOrders] = useState([])
  const [selectedOnlineOrder, setSelectedOnlineOrder] = useState(null)
  const [loading, setLoading] = useState(true)
  const [modal, setModal] = useState(null)
  const [editingProduct, setEditingProduct] = useState(null)
  const [securityModal, setSecurityModal] = useState(false)
  const [loadError, setLoadError] = useState('')
  const [recurringAction, setRecurringAction] = useState(null)
  const loadedTabs = useRef(new Set())
  const loadVersion = useRef(0)
  const pendingReads = useRef(new Map())

  async function load(background = true) {
    const version = ++loadVersion.current
    if (!background && !loadedTabs.current.has(tab)) setLoading(true)
    setLoadError('')
    try {
      const read = path => {
        if (!background && pendingReads.current.has(path)) return pendingReads.current.get(path)
        const request = api(path)
        pendingReads.current.set(path, request)
        const release = () => { if (pendingReads.current.get(path) === request) pendingReads.current.delete(path) }
        request.then(release, release)
        return request
      }
      const requests = {
        dashboard: () => read('/api/admin/dashboard'),
        products: () => Promise.all([read('/api/admin/products'), read('/api/store/categories')]),
        finance: () => read('/api/admin/expenses'),
        recurring: () => read('/api/admin/finance/recurring'),
        sales: () => read('/api/admin/sales'),
        'online-orders': () => read('/api/admin/store-orders')
      }
      const data = requests[tab] ? await requests[tab]() : null
      if (version !== loadVersion.current) return
      if (tab === 'dashboard') setDash(data)
      if (tab === 'products') { setProducts(data[0]); setProductCategories(Array.isArray(data[1]) ? data[1] : []) }
      if (tab === 'finance') setEntries(Array.isArray(data) ? data : [])
      if (tab === 'recurring') setRecurring(Array.isArray(data) ? data : [])
      if (tab === 'sales') setSales(Array.isArray(data) ? data : [])
      if (tab === 'online-orders') setOnlineOrders(Array.isArray(data) ? data : [])
      loadedTabs.current.add(tab)
    } catch (error) {
      if (version !== loadVersion.current) return
      if (error.status === 401 || error.code === 'ADMIN_OWNER_REQUIRED') onLogout()
      else setLoadError(error.message || 'Não foi possível carregar esta área.')
    } finally {
      if (version === loadVersion.current) setLoading(false)
    }
  }

  useEffect(() => {
    load(false)
    return () => { loadVersion.current++ }
  }, [tab])

  useEffect(() => {
    if (requestedTab !== 'movements') return
    const params = new URLSearchParams(location.search)
    params.set('tab', 'products')
    navigate({ pathname: location.pathname, search: params.toString() }, { replace: true })
  }, [location.pathname, location.search, navigate, requestedTab])

  function selectTab(key) {
    if (key === 'editor') { navigate('/?preview=draft&edit=1'); return }
    if (key === tab) return
    setModal(null)
    setSelectedOnlineOrder(null)
    navigate('/admin?tab=' + key)
    window.scrollTo({ top: 0, left: 0, behavior: 'instant' })
  }

  async function removeProduct(product) {
    const confirmed = window.confirm(
      'Excluir definitivamente o produto "' + product.name + '"? O cadastro, suas movimentações de estoque e os vínculos de mídia serão removidos. Essa ação não pode ser desfeita. Vendas e pedidos cancelados serão preservados. Operações não canceladas ou com pagamento aprovado impedem a exclusão.'
    )
    if (!confirmed) return
    try {
      await api('/api/admin/products/' + product.id, { method: 'DELETE' })
      alert('Produto e movimentações de estoque excluídos definitivamente.')
      await load()
    } catch (error) {
      alert(error.message)
    }
  }

  async function removeFinanceEntry(entry) {
    const confirmed = window.confirm(
      'Remover o gasto "' + entry.description + '" no valor de ' + money(entry.amount) + '?'
    )
    if (!confirmed) return
    try {
      await api('/api/admin/expenses/' + entry.id, { method: 'DELETE' })
      await load()
    } catch (error) {
      alert(error.message)
    }
  }

  async function removeRecurring(item) {
    if (!window.confirm('Remover o gasto recorrente "' + item.description + '"? Os gastos já registrados serão preservados.')) return
    setRecurringAction(item.id)
    try {
      await api('/api/admin/finance/recurring/' + item.id, { method:'DELETE' })
      await load()
    } catch (error) { alert(error.message) }
    finally { setRecurringAction(null) }
  }

  async function recordRecurring(item) {
    if (!window.confirm('Registrar o gasto de ' + money(item.amount) + ' com "' + item.description + '" na data de hoje?')) return
    setRecurringAction(item.id)
    try {
      await api('/api/admin/finance/recurring/' + item.id + '/record', { method:'POST', body:{ date:todayBR() } })
      await load()
    } catch (error) { alert(error.message) }
    finally { setRecurringAction(null) }
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
    clearAdminCsrfToken()
    onLogout()
  }

  const title = {
    dashboard: 'Visão geral',
    editor: 'Editor da loja',
    products: 'Produtos e estoque',
    sales: 'Histórico de vendas',
    pdv: 'Frente de caixa',
    'online-orders': 'Pedidos do site',
    finance: 'Gastos da loja',
    recurring: 'Gastos recorrentes',
    library: 'Biblioteca de mídia'
  }[tab]

  const cta = {
    products: ['+ Cadastrar produto', () => { setEditingProduct(null); setModal('product') }],
    finance: ['+ Registrar gasto', () => setModal('finance')],
    recurring: ['+ Novo gasto recorrente', () => setModal('recurring')]
  }[tab]

  return (
    <div className="admin-shell">
      <aside className="admin-side">
        <div className="brand"><span className="brand-mark">G</span><span>GALEO</span></div>
        {[
          ['dashboard', 'Visão geral'],
          ...(user?.role === 'owner' ? [['editor', 'Editor da loja']] : []),
          ['products', 'Produtos e estoque'],
          ['pdv', 'Frente de caixa'],
          ['sales', 'Histórico de vendas'],
          ['online-orders', 'Pedidos do site'],
          ['finance', 'Gastos da loja'],
          ['recurring', 'Gastos recorrentes'],
          ['library', 'Biblioteca de mídia']
        ].map(([key, label]) => (
          <button className={tab === key ? 'admin-nav active' : 'admin-nav'} onClick={() => selectTab(key)} key={key}>{label}</button>
        ))}
        <div className="admin-user"><strong>{user?.email}</strong><small>{user?.role}</small></div>
        <button className="admin-nav" onClick={() => setSecurityModal(true)}>Alterar senha</button>
        <button className="admin-nav logout" onClick={logout}>Sair</button>
      </aside>

      <main className="admin-main">
        <div className="admin-top">
          <div>
            <h1>{title}</h1>
          </div>
          {cta && <button className="button button-primary" onClick={cta[1]}>{cta[0]}</button>}
        </div>

        {loading ? <div className="admin-loading">Carregando dados reais…</div> : null}
        {loadError && <div className="admin-panel" role="alert"><p>{loadError}</p><button type="button" onClick={() => load(false)}>Tentar novamente</button></div>}
        {!loading && tab === 'editor' && user?.role === 'owner' && (advancedEditor ? <HomeEditor user={user} /> : <VisualEditorLaunch />)}
        {!loading && tab === 'library' && <MediaLibrary api={api} csrf={getAdminCsrfToken} role={user?.role} />}
        {!loading && tab === 'pdv' && <PointOfSale api={api} operatorId={user.id} onSaleCreated={() => load(true)} />}
        {!loading && tab === 'dashboard' && dash && (
          <>
            <div className="metric-grid metric-grid-extended">
              <div className="metric"><span>Produtos no catálogo</span><strong>{dash.products.active_count ?? dash.products.count}</strong></div>
              <div className="metric"><span>Unidades em estoque</span><strong>{dash.products.stock}</strong></div>
              <div className="metric"><span>Produtos em estoque baixo</span><strong>{dash.products.low_stock}</strong></div>
              <div className="metric"><span>Vendas no mês</span><strong>{dash.sales.count}</strong></div>
              <div className="metric"><span>Faturamento do mês</span><strong>{money(dash.sales.total)}</strong></div>
              <div className="metric"><span>Gastos do mês</span><strong>{money(dash.expense)}</strong></div>
              <div className="metric"><span>Resultado do mês</span><strong>{money(Number(dash.sales.total || 0) + Number(dash.income || 0) - Number(dash.expense || 0))}</strong></div>
            </div>
            <div className="admin-panel dashboard-split">
              <div><h2>Estoque crítico</h2><p>{dash.products.low_stock} produto(s) no estoque mínimo ou abaixo.</p></div>
              <div><h2>Frente de caixa</h2><p>Selecione os produtos e registre as vendas da loja.</p><button className="text-button" onClick={() => selectTab('pdv')}>Abrir frente de caixa ↗</button></div>
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
                    <td>{Number(product.active) ? 'Ativo' : 'Rascunho — fora do catálogo'}</td>
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
            <div className="orders-toolbar"><strong>{onlineOrders.filter((order)=>order.status!=='CANCELLED' && order.status!=='DELIVERED').length} em andamento</strong></div>
            <table>
              <thead><tr><th>Pedido</th><th>Cliente</th><th>Data</th><th>Itens</th><th>Total</th><th>Status</th><th></th></tr></thead>
              <tbody>
                {onlineOrders.map((order)=><tr key={order.id}><td><strong>{order.code}</strong></td><td><strong>{order.customer_name}</strong><small>{order.customer_email}</small></td><td>{dateBR(order.created_at)}</td><td>{(order.items||[]).reduce((sum,item)=>sum+Number(item.quantity||0),0)}</td><td><strong>{money(order.total)}</strong></td><td><span className={'status-pill status-'+String(order.status).toLowerCase()}>{order.status_label||order.status}</span></td><td className="admin-actions"><button onClick={()=>openOnlineOrder(order.id)}>Abrir</button></td></tr>)}
                {!onlineOrders.length && <tr><td colSpan="7" className="empty-state">Nenhum pedido do site recebido ainda.</td></tr>}
              </tbody>
            </table>
          </div>
        )}

        {!loading && tab === 'finance' && (
          <div className="admin-panel">
            <table>
              <thead><tr><th>Gasto</th><th>Data</th><th>Valor</th><th></th></tr></thead>
              <tbody>
                {entries.map((entry) => (
                  <tr key={entry.id}>
                    <td><strong>{entry.description}</strong></td>
                    <td>{dateBR(entry.date)}</td>
                    <td>{money(entry.amount)}</td>
                    <td className="admin-actions">
                      <button onClick={() => removeFinanceEntry(entry)}>Remover</button>
                    </td>
                  </tr>
                ))}
                {!entries.length && <tr><td colSpan="4" className="empty-state">Nenhum gasto registrado.</td></tr>}
              </tbody>
            </table>
          </div>
        )}

        {!loading && tab === 'recurring' && (
          <div className="admin-panel">
            <table>
              <thead><tr><th>Gasto</th><th>Valor mensal</th><th>Dia habitual</th><th></th></tr></thead>
              <tbody>
                {recurring.map((item) => (
                  <tr key={item.id}><td>{item.description}</td><td>{money(item.amount)}</td><td>{item.due_day}</td><td className="admin-actions"><button disabled={Boolean(recurringAction) || item.current_month_recorded} onClick={() => recordRecurring(item)}>{item.current_month_recorded ? 'Registrado neste mês' : 'Registrar gasto'}</button><button disabled={Boolean(recurringAction)} onClick={() => removeRecurring(item)}>Remover</button></td></tr>
                ))}
                {!recurring.length && <tr><td colSpan="4" className="empty-state">Nenhum gasto recorrente cadastrado.</td></tr>}
              </tbody>
            </table>
          </div>
        )}

      </main>

      {modal === 'product' && <ProductForm product={editingProduct} categories={productCategories} onClose={() => setModal(null)} onDone={() => { setModal(null); setEditingProduct(null); load() }} />}
      {modal === 'stock' && <StockModal products={products} onClose={() => setModal(null)} onDone={() => { setModal(null); load() }} />}
      {modal === 'finance' && <FinanceModal onClose={() => setModal(null)} onDone={() => { setModal(null); load() }} />}
      {modal === 'recurring' && <RecurringModal onClose={() => setModal(null)} onDone={() => { setModal(null); load() }} />}
      {selectedOnlineOrder && <OnlineOrderModal order={selectedOnlineOrder} onClose={()=>setSelectedOnlineOrder(null)} onStatus={updateOnlineOrderStatus} />}
      {securityModal && <PasswordModal onClose={() => setSecurityModal(false)} onDone={() => setSecurityModal(false)} />}
    </div>
  )
}

export default function AdminGate() {
  const [user, setUser] = useState(null)
  const [checking, setChecking] = useState(true)

  useEffect(() => {
    function requireAdminLogin() {
      clearAdminCsrfToken()
      setUser(null)
    }
    window.addEventListener('galeo-admin-auth-required', requireAdminLogin)
    api('/api/auth/me')
      .then((data) => setUser(data.user))
      .catch(() => {})
      .finally(() => setChecking(false))
    return () => window.removeEventListener('galeo-admin-auth-required', requireAdminLogin)
  }, [])

  if (checking) return <main className="admin-login"><p>Verificando sessão...</p></main>
  return user?.role === 'owner'
    ? <Admin user={user} onLogout={() => setUser(null)} />
    : <Login onLogin={setUser} />
}
