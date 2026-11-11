import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import ProductSearch from './ProductSearch'
import MediaLibrary from './MediaLibrary'
import PointOfSale from './PointOfSale'
import { HomeDraftComparison, HomeSectionOrder, HomeVersionHistory } from './HomeWorkflow'
import HomeCampaignEditor from './HomeCampaignEditor'
import { adminApi as api, clearAdminCsrfToken, getAdminCsrfToken } from './adminApi'
import { activeProductVariants, productHasVariants } from './productVariants'
import ShippingServiceIdentity from './ShippingServiceIdentity'
import AdminErrorEvents from './AdminErrorEvents'
import ProductWizard from './admin/ProductWizard'
import { SearchIcon } from './icons'
import { ResponsiveImage } from './ResponsiveImage'
import { imageWidths } from './cloudinaryImage'
import { DEFAULT_GOOGLE_REVIEW_URL } from './siteNavigation'
import './product-variants.css'
import './Admin.css'
import './shipping.css'

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

          {area === 'footer' && footer && <div className="home-editor-form single"><label>Nome<input value={footer.brand || ''} onChange={(e) => setFooter((current) => ({ ...current, brand: e.target.value }))} /></label><label>Ano<input value={footer.year || ''} onChange={(e) => setFooter((current) => ({ ...current, year: e.target.value }))} /></label><label>Instagram (@perfil ou link)<input value={footer.instagram || ''} onChange={(e) => setFooter((current) => ({ ...current, instagram: e.target.value }))} placeholder="@galeostore" /></label><label>WhatsApp com DDD<input value={footer.whatsapp || ''} inputMode="tel" onChange={(e) => setFooter((current) => ({ ...current, whatsapp: e.target.value }))} placeholder="11 99999-9999" /></label><label>Link de avaliação do Google (vazio esconde as estrelas)<input value={footer.google_review ?? DEFAULT_GOOGLE_REVIEW_URL} onChange={(e) => setFooter((current) => ({ ...current, google_review: e.target.value }))} placeholder="Link da loja no Google Maps" /></label><div className="home-editor-savebar"><button className="button button-primary" type="button" onClick={() => saveSetting('footer', footer)} disabled={saving}>Salvar rodapé no rascunho ↗</button></div></div>}

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
  let shippingDetails = order.shipping_details
  if (typeof shippingDetails === 'string') { try { shippingDetails = JSON.parse(shippingDetails) } catch { shippingDetails = null } }
  const statuses=[['RECEIVED','Recebido'],['CONFIRMED','Confirmado'],['PREPARING','Em preparação'],['SHIPPED','Enviado'],['DELIVERED','Entregue'],['CANCELLED','Cancelado']]
  async function save(){setSaving(true);try{await onStatus(order.id,status);onClose()}finally{setSaving(false)}}
  return <div className="modal-backdrop"><div className="modal-panel online-order-modal">
    <div className="modal-header"><div><h2>{order.code}</h2></div><button onClick={onClose}>Fechar</button></div>
    <div className="online-order-summary"><div><span>Cliente</span><strong>{order.customer_name}</strong><small>{order.customer_email}{order.customer_phone?' · '+order.customer_phone:''}</small></div><div><span>Total</span><strong>{money(order.total)}</strong><small>{dateBR(order.created_at)}</small></div></div>
    <div className="online-order-payment"><div><span>Pagamento</span><strong>{({PENDING:'Aguardando',APPROVED:'Aprovado',REJECTED:'Recusado',CANCELLED:'Cancelado',REFUNDED:'Estornado'})[order.payment_status]||'Não informado'}</strong><small>{order.payment_provider ? order.payment_provider + (order.payment_method?' · '+order.payment_method:'') : 'Ainda não vinculado'}</small></div><div><span>Venda</span><strong>{order.sale_id ? 'VDA-' + String(order.sale_id).padStart(6,'0') : 'Será criada automaticamente'}</strong></div></div>
    <div className="online-order-address"><h3>Entrega</h3><p>{order.street}, {order.number}{order.complement?' · '+order.complement:''}<br />{order.neighborhood} · {order.city} / {order.state}<br />CEP {order.postal_code}</p></div>
    {shippingDetails && <div className="online-order-address"><h3>Frete escolhido</h3><ShippingServiceIdentity service={shippingDetails}><small>{money(order.shipping_fee)}{shippingDetails.delivery_days !== null && shippingDetails.delivery_days !== '' && Number.isFinite(Number(shippingDetails.delivery_days)) && <> · {Number(shippingDetails.delivery_days)} {Number(shippingDetails.delivery_days) === 1 ? 'dia útil' : 'dias úteis'}</>}</small></ShippingServiceIdentity></div>}
    <div className="online-order-items"><h3>Itens</h3>{order.items?.map((item,index)=><div key={item.id ?? index}><span>{item.quantity} × {item.product_name}{item.size_label && ' — tamanho ' + item.size_label}</span><strong>{money(item.line_total)}</strong></div>)}</div>
    <label className="online-order-status">Status<select value={status} onChange={(e)=>setStatus(e.target.value)}>{statuses.map(([value,label])=><option key={value} value={value}>{label}</option>)}</select></label>
    <div className="modal-actions"><button className="button button-ghost" type="button" onClick={onClose}>Voltar</button><button className="button button-primary" type="button" disabled={saving||status===order.status} onClick={save}>{saving?'Salvando…':'Salvar status'}</button></div>
  </div></div>
}

function ShippingSettings({ search }) {
  const [status, setStatus] = useState(null)
  const [loading, setLoading] = useState(true)
  const [connecting, setConnecting] = useState(false)
  const [error, setError] = useState('')
  const [retry, setRetry] = useState(0)
  const statusRequest = useRef(null)
  const callback = new URLSearchParams(search).get('shipping')

  useEffect(() => {
    let active = true
    setLoading(true)
    setError('')
    if (!statusRequest.current || statusRequest.current.retry !== retry) statusRequest.current = { retry, promise: api('/api/admin/shipping') }
    statusRequest.current.promise.then(data => { if (active) setStatus(data) })
      .catch(err => { if (active) setError(err.message) })
      .finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [retry])

  async function connect() {
    if (connecting) return
    setConnecting(true)
    setError('')
    try {
      const data = await api('/api/admin/shipping/connect', { method:'POST' })
      const url = new URL(data.authorization_url)
      const expectedHost = status?.environment === 'sandbox' ? 'sandbox.melhorenvio.com.br' : 'melhorenvio.com.br'
      if (url.protocol !== 'https:' || url.hostname !== expectedHost || url.port || url.username || url.password) throw new Error('O servidor não confirmou um endereço seguro para conectar o Melhor Envio.')
      window.location.assign(url.href)
    } catch (err) { setError(err.message); setConnecting(false) }
  }

  if (loading) return <section className="admin-panel admin-shipping-settings"><p role="status">Verificando a conexão com o Melhor Envio…</p></section>
  const postalCode = String(status?.origin_postal_code || '').replace(/\D/g, '')
  return <section className="admin-panel admin-shipping-settings">
    <h2>Melhor Envio</h2>
    {callback === 'connected' && status?.connected && <p className="admin-shipping-success" role="status">Conta conectada com sucesso.</p>}
    {callback === 'error' && <p className="admin-error" role="alert">Não foi possível concluir a conexão. Tente conectar a conta novamente.</p>}
    {error && <div role="alert"><p className="admin-error">{error}</p><button type="button" className="button button-ghost" onClick={() => setRetry(value => value + 1)}>Verificar novamente</button></div>}
    {status && <>
      <dl className="admin-shipping-status"><div><dt>Conexão</dt><dd>{status.connected ? 'Conta conectada' : 'Conta ainda não conectada'}</dd></div><div><dt>CEP de origem</dt><dd>{postalCode.length === 8 ? postalCode.slice(0, 5) + '-' + postalCode.slice(5) : 'Ainda não configurado'}</dd></div>{status.environment === 'sandbox' && <div><dt>Ambiente</dt><dd>Teste — as cotações não são de produção</dd></div>}</dl>
      {!status.configured ? <p>As credenciais do Melhor Envio precisam ser configuradas na hospedagem para conectar a conta.</p> : <>
        <p>{status.connected ? 'Os clientes poderão consultar as opções de frete no carrinho quando as peças tiverem peso e medidas cadastrados.' : 'Conecte a conta da loja para calcular os preços e os prazos de entrega no carrinho.'}</p>
        <button type="button" className="button button-primary" disabled={connecting} onClick={connect}>{connecting ? 'Abrindo Melhor Envio…' : status.connected ? 'Reconectar Melhor Envio' : 'Conectar Melhor Envio ↗'}</button>
      </>}
      <p>Em Produtos e estoque, abra cada peça e preencha Dados para entrega com o peso e as medidas reais da embalagem.</p>
      <p>Esta etapa calcula o frete. A compra e a emissão de etiquetas serão feitas em uma próxima etapa.</p>
    </>}
  </section>
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
  const tab = requestedTab === 'movements' ? 'products' : ['dashboard','editor','products','pdv','sales','online-orders','finance','recurring','library', ...(user?.role === 'owner' ? ['shipping', 'errors'] : [])].includes(requestedTab) ? requestedTab : 'dashboard'
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
  const [wizardStep, setWizardStep] = useState('basics')
  const [wizardKey, setWizardKey] = useState(0)
  const [productQuery, setProductQuery] = useState('')
  const [productFilter, setProductFilter] = useState('all')
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

  function openProduct(product, step = 'basics') {
    setEditingProduct(product)
    setWizardStep(step)
    setWizardKey(value => value + 1)
    setModal('product')
  }

  function closeProduct() {
    setModal(null)
    setEditingProduct(null)
    load()
  }

  const productBrands = useMemo(() => [...new Set(products.map(product => String(product.brand || '').trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'pt-BR')), [products])
  const productFilters = [
    ['all', 'Todos', () => true],
    ['live', 'Na loja', product => Boolean(Number(product.active))],
    ['draft', 'Rascunhos', product => !Number(product.active)],
    ['low', 'Estoque baixo', product => Number(product.stock) <= Number(product.min_stock)],
    ['nophoto', 'Sem foto', product => !product.image]
  ]
  const plainText = value => String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
  const visibleProducts = products.filter(productFilters.find(([key]) => key === productFilter)[2]).filter(product => {
    const query = plainText(productQuery).trim()
    return !query || plainText([product.name, product.brand, product.category].join(' ')).includes(query)
  })

  const title = {
    dashboard: 'Visão geral',
    editor: 'Editor da loja',
    products: 'Produtos e estoque',
    sales: 'Histórico de vendas',
    pdv: 'Frente de caixa',
    'online-orders': 'Pedidos do site',
    finance: 'Gastos da loja',
    recurring: 'Gastos recorrentes',
    library: 'Biblioteca de mídia',
    shipping: 'Entregas'
  }[tab]

  const cta = {
    products: ['+ Novo produto', () => openProduct(null)],
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
          ['library', 'Biblioteca de mídia'],
          ...(user?.role === 'owner' ? [['shipping', 'Entregas'], ['errors', 'Erros recentes']] : [])
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
        {!loading && tab === 'shipping' && user?.role === 'owner' && <ShippingSettings search={location.search} />}
        {!loading && tab === 'errors' && user?.role === 'owner' && <AdminErrorEvents />}
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
          <div className="admin-products">
            <div className="admin-products-toolbar">
              <label className="admin-products-search"><SearchIcon /><input type="search" value={productQuery} onChange={event => setProductQuery(event.target.value)} aria-label="Buscar produto" placeholder="Buscar por nome, marca ou categoria" /></label>
              <div className="admin-products-filters wizard-chips" role="group" aria-label="Mostrar produtos">
                {productFilters.map(([key, label, test]) => <button key={key} type="button" aria-pressed={productFilter === key} onClick={() => setProductFilter(key)}>{label} ({products.filter(test).length})</button>)}
              </div>
            </div>
            {visibleProducts.length ? <ul className="admin-product-list">
              {visibleProducts.map((product) => {
                const low = Number(product.stock) <= Number(product.min_stock)
                return <li key={product.id}>
                  <article className="admin-product-card" aria-label={product.name}>
                    <div className="admin-product-thumb">{product.image ? <ResponsiveImage src={product.image} widths={imageWidths.thumbnail} sizes="72px" alt="" loading="lazy" decoding="async" /> : <span>Sem foto</span>}</div>
                    <div className="admin-product-info">
                      <strong>{product.name}</strong>
                      <span>{[product.category, product.brand].filter(Boolean).join(' · ') || 'Sem categoria'}</span>
                      <span className="admin-product-price">{Number(product.price) > 0 ? money(product.price) : 'Preço a definir'}</span>
                    </div>
                    <div className="admin-product-state">
                      <span className={'admin-product-badge' + (Number(product.active) ? ' is-live' : '')}>{Number(product.active) ? 'Na loja' : 'Rascunho'}</span>
                      <span className={'admin-product-stock' + (low ? ' is-low' : '')}>{product.stock} em estoque{low ? ' · baixo' : ''}</span>
                    </div>
                    <div className="admin-product-actions">
                      <button type="button" onClick={() => openProduct(product)}>Editar</button>
                      <button type="button" onClick={() => openProduct(product, 'photos')}>Fotos</button>
                      <button type="button" onClick={() => { setModal('stock'); setEditingProduct(product) }}>Estoque</button>
                      <details className="admin-product-more">
                        <summary aria-label={'Mais ações: ' + product.name}>⋯</summary>
                        <div><button type="button" onClick={event => { event.currentTarget.closest('details').open = false; removeProduct(product) }}>Excluir</button></div>
                      </details>
                    </div>
                  </article>
                </li>
              })}
            </ul> : <p className="admin-products-empty">{products.length ? 'Nenhum produto encontrado com esse filtro.' : <><strong>Nenhum produto cadastrado ainda.</strong> Toque em "+ Novo produto" para começar.</>}</p>}
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

      {modal === 'product' && <ProductWizard key={wizardKey} product={editingProduct} categories={productCategories} brands={productBrands} role={user?.role} initialStep={wizardStep} onClose={closeProduct} onDone={closeProduct} onAnother={() => { setEditingProduct(null); setWizardStep('basics'); setWizardKey(value => value + 1); load() }} />}
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
