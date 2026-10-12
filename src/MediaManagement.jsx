import { useEffect, useId, useRef, useState } from 'react'
import './MediaManagement.css'

export function MediaLibraryPreferences({ api, disabled = false, onMessage, onError }) {
  const [saved, setSaved] = useState(false)
  const [checked, setChecked] = useState(false)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const titleId = useId()
  async function load() {
    setLoading(true); setError('')
    try {
      const data = await api('/api/admin/media-library-preferences')
      setSaved(Boolean(data.auto_prepare)); setChecked(Boolean(data.auto_prepare))
    } catch (error) { setError(error.message || 'Não foi possível carregar a preferência.') }
    finally { setLoading(false) }
  }
  useEffect(() => { load() }, [])
  async function save() {
    if (busy || disabled || loading) return
    setBusy(true); setError('')
    try {
      const data = await api('/api/admin/media-library-preferences', { method: 'PUT', body: { auto_prepare: checked } })
      setSaved(Boolean(data.auto_prepare)); setChecked(Boolean(data.auto_prepare))
      onMessage?.(data.auto_prepare ? 'Novas fotos da biblioteca e dos produtos serão preparadas automaticamente. Você continua escolhendo qual versão usar.' : 'Preparação automática desativada. Você pode remover o fundo de cada foto quando quiser.')
    } catch (error) { setError(error.message); onError?.(error.message) }
    finally { setBusy(false) }
  }
  return <section className="media-library-preferences" aria-labelledby={titleId} aria-busy={loading || busy}>
    <h3 id={titleId}>Preparar novas fotos</h3>
    <label className="media-preferences-checkbox">
      <input type="checkbox" checked={checked} disabled={disabled || busy || loading || Boolean(error)} onChange={event => setChecked(event.target.checked)} />
      <span>Preparar versão sem fundo automaticamente nas novas fotos da biblioteca e dos produtos</span>
    </label>
    <p>A IA usa créditos do Cloudinary uma vez por foto e preserva o original. A preparação gera uma prévia; você decide qual versão usar. Fotos já enviadas permanecem como estão.</p>
    {error && <p className="admin-error" role="alert">{error}</p>}
    {loading && <p className="page-note" role="status">Carregando preferência…</p>}
    <div className="media-management-actions">
      <button type="button" className="text-button" disabled={disabled || busy || loading || checked === saved || Boolean(error)} onClick={save}>{busy ? 'Salvando…' : 'Salvar preferência'}</button>
      {error && <button type="button" className="text-button" disabled={disabled || busy || loading} onClick={load}>Tentar novamente</button>}
    </div>
  </section>
}

export default function MediaManagement({ item, api, csrf, disabled, onClose, onUpdate, onReplacement, run }) {
  const [title, setTitle] = useState(item.title || '')
  const [file, setFile] = useState(null)
  const [busy, setBusy] = useState('')
  const input = useRef(null)
  const titleId = useId()
  const heading = useRef(null)
  useEffect(() => {
    setTitle(item.title || ''); setFile(null)
    if (input.current) input.current.value = ''
    heading.current?.focus({ preventScroll: true })
  }, [item.id, item.title])
  const act = async (key, job) => run(key + item.id, async () => {
    setBusy(key)
    try { await job() } finally { setBusy('') }
  })
  async function rename(event) {
    event.preventDefault()
    if (!title.trim() || busy || disabled) return
    await act('rename', async () => {
      const data = await api('/api/admin/media-library/' + item.id, { method: 'PATCH', body: { title: title.trim() } })
      onUpdate(data.item)
    })
  }
  async function replace() {
    if (!file || busy || disabled) return
    await act('replace', async () => {
      const body = new FormData(); body.append('media', file)
      const response = await fetch('/api/admin/media-library/' + item.id + '/replacement', { method: 'POST', credentials: 'include', headers: { 'X-CSRF-Token': csrf() }, body })
      const data = await response.json().catch(() => null)
      if (!response.ok) throw new Error(data?.error || 'Não foi possível enviar a nova versão. O original foi mantido.')
      if (!data?.item) throw new Error('O envio não devolveu a nova versão. Atualize a biblioteca antes de tentar novamente.')
      setFile(null); if (input.current) input.current.value = ''
      await onReplacement(data.item, data.message)
    })
  }
  const locked = Boolean(disabled || busy)
  return <section className="media-management" aria-labelledby={titleId} data-testid="media-management">
    <div className="media-comparison-heading">
      <div><h3 id={titleId} ref={heading} tabIndex="-1">Editar mídia</h3><p>{item.title || 'Sem título'}</p></div>
      <button type="button" className="text-button" disabled={locked} onClick={onClose}>Fechar edição</button>
    </div>
    <form className="media-rename-form" onSubmit={rename}>
      <label>Nome da mídia<input type="text" value={title} maxLength="160" required disabled={locked} onChange={event => setTitle(event.target.value)} /></label>
      <button type="submit" className="text-button" disabled={locked || !title.trim() || title.trim() === item.title}>{busy === 'rename' ? 'Salvando…' : 'Salvar nome'}</button>
    </form>
    <div className="media-replacement-form">
      <h4>Substituir arquivo com segurança</h4>
      <p>O novo arquivo será salvo separadamente na biblioteca. Depois, escolha a nova versão no produto ou no rascunho da Home. A foto original, os produtos e a Home publicada permanecem disponíveis.</p>
      <label>Novo {item.media_type === 'video' ? 'vídeo' : 'arquivo de imagem'}
        <input ref={input} type="file" disabled={locked} accept={item.media_type === 'video' ? 'video/mp4,video/webm,video/quicktime' : 'image/jpeg,image/png,image/webp,image/avif,.jpg,.jpeg,.jfif,.png,.webp,.avif'} onChange={event => setFile(event.target.files[0] || null)} />
      </label>
      <button type="button" className="button button-primary" disabled={locked || !file} onClick={replace}>{busy === 'replace' ? 'Enviando nova versão…' : 'Enviar nova versão'}</button>
    </div>
  </section>
}
