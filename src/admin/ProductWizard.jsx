import { useEffect, useId, useRef, useState } from 'react'
import { adminApi as api } from '../adminApi'
import ProductCard from '../ProductCard'
import { CheckIcon } from '../icons'
import ProductPhotos from './ProductPhotos'
import useProductInventory from './useProductInventory'
import { packageSuggestion, packageText, sizeSuggestions, withPackageDefaults } from './productDefaults'
import './products-admin.css'

const money = value => Number(value || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
const shippingKeys = ['shipping_weight', 'shipping_width', 'shipping_height', 'shipping_length']
const steps = [['basics', 'O básico'], ['photos', 'Fotos'], ['sizes', 'Tamanhos e estoque'], ['review', 'Revisar e publicar']]

const blankProduct = {
  name: '', brand: '', category_id: '', description: '', price: '', cost: '', min_stock: 0,
  image: '', image_asset_id: null, image_variant: null, video: '',
  shipping_weight: '', shipping_width: '', shipping_height: '', shipping_length: '', active: false
}

const formFrom = product => product ? {
  ...blankProduct,
  ...Object.fromEntries(Object.keys(blankProduct).map(key => [key, product[key] ?? blankProduct[key]])),
  image_asset_id: null,
  image_variant: null,
  category_id: product.category_id || '',
  active: Boolean(Number(product.active))
} : blankProduct

const samePackage = (form, suggestion) => Number(form.shipping_weight) === suggestion.weight && Number(form.shipping_width) === suggestion.width
  && Number(form.shipping_height) === suggestion.height && Number(form.shipping_length) === suggestion.length

function Stepper({ label, value, onChange, disabled, hideLabel = false }) {
  const id = useId()
  const number = Math.max(0, Number(value) || 0)
  return (
    <div className={'wizard-stepper' + (hideLabel ? ' is-compact' : '')}>
      <label htmlFor={id} className={hideLabel ? 'wizard-visually-hidden' : undefined}>{label}</label>
      <div className="wizard-stepper-control">
        <button type="button" aria-label={'Diminuir ' + label.toLowerCase()} disabled={disabled || number === 0} onClick={() => onChange(number - 1)}>−</button>
        <input id={id} type="number" inputMode="numeric" min="0" step="1" value={value} disabled={disabled} required onChange={event => onChange(event.target.value)} />
        <button type="button" aria-label={'Aumentar ' + label.toLowerCase()} disabled={disabled} onClick={() => onChange(number + 1)}>+</button>
      </div>
    </div>
  )
}

// Product registration in four short steps (basics, photos, sizes, review).
// A new product is saved as a draft right after the first step, so photos
// upload at once and nothing is lost if the window closes. When editing, the
// steps are tabs and one button saves everything.
export default function ProductWizard({ product, categories = [], brands = [], role, initialStep = 'basics', onClose, onDone, onAnother }) {
  const editing = Boolean(product?.id)
  const [savedId, setSavedId] = useState(Number(product?.id || 0))
  const [form, setForm] = useState(() => formFrom(product))
  const [step, setStep] = useState(editing && steps.some(([key]) => key === initialStep) ? initialStep : 'basics')
  const [saving, setSaving] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [refreshing, setRefreshing] = useState(false)
  const [editingPackage, setEditingPackage] = useState(false)
  const [newSize, setNewSize] = useState('')
  const [finished, setFinished] = useState(null)
  const inventory = useProductInventory(product)
  const titleId = useId(), brandsId = useId(), priceId = useId(), costId = useId(), costHintId = useId()
  const heading = useRef(null)
  const firstRender = useRef(true)
  const set = (key, value) => setForm(current => ({ ...current, [key]: value }))
  const category = categories.find(item => String(item.id) === String(form.category_id))
  const categoryName = category?.name || ''
  const stepIndex = steps.findIndex(([key]) => key === step)
  const busy = saving || uploading || refreshing
  const packageComplete = shippingKeys.every(key => Number(form[key]) > 0)
  const suggestion = packageSuggestion(categoryName)
  const stockTotal = inventory.sizesEnabled ? inventory.total : Math.max(0, Number(inventory.stock) || 0)

  useEffect(() => {
    if (firstRender.current) { firstRender.current = false; return }
    heading.current?.focus({ preventScroll: true })
  }, [step, finished])

  useEffect(() => {
    const close = event => { if (event.key === 'Escape' && !busy) onClose() }
    window.addEventListener('keydown', close)
    return () => window.removeEventListener('keydown', close)
  }, [busy, onClose])

  function chooseCategory(next) {
    setForm(current => {
      const updated = { ...current, category_id: next?.id || '' }
      if (editing) return updated
      // New products get the usual package of the category, replacing only an
      // earlier suggestion, never measurements the owner typed.
      const previous = packageSuggestion(categoryName)
      const cleared = samePackage(current, previous) ? Object.fromEntries(shippingKeys.map(key => [key, ''])) : {}
      return withPackageDefaults({ ...updated, ...cleared }, next?.name || '')
    })
  }

  async function save(active) {
    const present = shippingKeys.filter(key => String(form[key] ?? '').trim() !== '')
    if (present.length && present.length !== shippingKeys.length) throw new Error('Preencha o peso e as três medidas para entrega, ou deixe todos esses campos vazios.')
    if (present.some(key => !Number.isFinite(Number(form[key])) || Number(form[key]) <= 0)) throw new Error('O peso e as medidas para entrega precisam ser maiores que zero.')
    const body = {
      name: String(form.name || '').trim(),
      brand: String(form.brand || '').trim(),
      category_id: Number(form.category_id) || null,
      description: form.description || '',
      price: Number(form.price || 0),
      cost: Number(form.cost || 0),
      min_stock: Number(form.min_stock || 0),
      image: form.image || '',
      image_asset_id: Number(form.image_asset_id) || null,
      image_variant: Number(form.image_asset_id) ? form.image_variant : null,
      video: form.video || '',
      active,
      ...Object.fromEntries(shippingKeys.map(key => [key, present.length ? Number(form[key]) : null])),
      ...inventory.requestFields(!savedId)
    }
    const saved = await api(savedId ? '/api/admin/products/' + savedId : '/api/admin/products', { method: savedId ? 'PUT' : 'POST', body })
    const id = Number(saved?.id || savedId)
    if (!id) throw new Error('O servidor não confirmou o cadastro do produto.')
    setSavedId(id)
    inventory.remember(saved)
    setForm(current => ({ ...current, active }))
    return saved
  }

  async function run(action) {
    setSaving(true)
    setError('')
    setNotice('')
    try {
      await action()
    } catch (err) {
      setError(err.message || 'Não foi possível salvar. Tente de novo.')
      if (err.code === 'INVENTORY_CHANGED') inventory.setConflict(true)
    } finally {
      setSaving(false)
    }
  }

  async function refreshInventory() {
    setRefreshing(true)
    try {
      const products = await api('/api/admin/products')
      const saved = products.find(item => Number(item.id) === savedId)
      if (!saved) throw new Error('O produto não está mais disponível. Feche e atualize a lista.')
      inventory.remember(saved)
      setError('')
      setNotice('Quantidades atualizadas. Confira o estoque antes de salvar; os demais campos que você editou foram mantidos.')
    } catch (err) { setError(err.message) }
    finally { setRefreshing(false) }
  }

  function next() {
    if (step === 'basics') {
      if (!String(form.name || '').trim()) return setError('Escreva o nome do produto para continuar.')
      return run(async () => { await save(false); setStep('photos') })
    }
    if (step === 'photos') { setError(''); return setStep('sizes') }
    if (step === 'sizes') return run(async () => { await save(false); setStep('review') })
  }

  const publishMissing = [!String(form.name || '').trim() && 'o nome', !(Number(form.price) > 0) && 'o preço de venda'].filter(Boolean)

  function finish(active) {
    if (active && publishMissing.length) return setError('Para publicar, falta ' + publishMissing.join(' e ') + '.')
    run(async () => { await save(active); setFinished({ active }) })
  }

  function submit(event) {
    event.preventDefault()
    if (busy) return
    if (editing) return run(async () => { await save(form.active); onDone() })
    if (step === 'review') return finish(true)
    next()
  }

  function removeSuggested(size) {
    const row = inventory.rows.find(item => item.active && String(item.size).trim().toLocaleUpperCase('pt-BR') === size.toLocaleUpperCase('pt-BR'))
    if (row) setError(inventory.removeRow(row))
  }

  function addCustomSize() {
    const size = newSize.trim()
    if (!size) return
    inventory.addSize(size)
    setNewSize('')
  }

  const checks = [
    { ok: Boolean(String(form.name || '').trim()), required: true, text: String(form.name || '').trim() ? 'Nome: ' + form.name : 'Falta o nome' },
    { ok: Number(form.price) > 0, required: true, text: Number(form.price) > 0 ? 'Preço: ' + money(form.price) : 'Falta o preço de venda' },
    { ok: Boolean(form.image), text: form.image ? 'Foto de capa escolhida' : 'Sem foto de capa (recomendado colocar)' },
    { ok: stockTotal > 0, text: stockTotal > 0 ? stockTotal + (stockTotal === 1 ? ' unidade' : ' unidades') + ' em estoque' : 'Sem estoque: aparece como indisponível' },
    { ok: packageComplete, text: packageComplete ? 'Embalagem para o frete: ' + packageText(form) : 'Sem medidas da embalagem: o frete não será calculado' },
    { ok: Boolean(String(form.description || '').trim()), text: String(form.description || '').trim() ? 'Descrição preenchida' : 'Sem descrição (opcional)' }
  ]

  if (finished) {
    return (
      <div className="modal-backdrop product-modal-backdrop">
        <section className="product-wizard" role="dialog" aria-modal="true" aria-labelledby={titleId}>
          <div className="wizard-done" role="status">
            <span className="wizard-done-mark" aria-hidden="true"><CheckIcon /></span>
            <h2 id={titleId} ref={heading} tabIndex="-1">{finished.active ? 'Produto publicado!' : 'Rascunho salvo'}</h2>
            <p>{finished.active ? 'O produto já aparece no catálogo da loja.' : 'O produto ficou guardado só no Admin. Quando quiser vender, abra e publique.'}</p>
            <div className="wizard-done-actions">
              {finished.active && <a className="button button-ghost" href={'/produto/' + savedId} target="_blank" rel="noopener noreferrer">Ver na loja ↗</a>}
              <button type="button" className="button button-ghost" onClick={onAnother}>Cadastrar outro</button>
              <button type="button" className="button button-primary" onClick={onDone}>Voltar para a lista</button>
            </div>
          </div>
        </section>
      </div>
    )
  }

  return (
    <div className="modal-backdrop product-modal-backdrop">
      <form className="product-wizard" role="dialog" aria-modal="true" aria-labelledby={titleId} onSubmit={submit} noValidate={false}>
        <header className="wizard-header">
          <h2 id={titleId}>{editing ? 'Editar produto' : 'Cadastrar produto'}</h2>
          <button type="button" className="wizard-close" aria-label="Fechar formulário do produto" disabled={busy} onClick={onClose}>×</button>
          <nav aria-label="Etapas do cadastro">
            <ol className="wizard-steps">
              {steps.map(([key, label], index) => {
                const reachable = editing || index < stepIndex
                return <li key={key} className={index < stepIndex && !editing ? 'is-done' : key === step ? 'is-current' : undefined}>
                  <button type="button" aria-current={key === step ? 'step' : undefined} disabled={!reachable || busy} onClick={() => { setError(''); setStep(key) }}>
                    <span className="wizard-step-mark" aria-hidden="true">{index < stepIndex && !editing ? <CheckIcon /> : index + 1}</span>
                    <span className="wizard-step-label">{editing && key === 'review' ? 'Na loja' : label}</span>
                  </button>
                </li>
              })}
            </ol>
          </nav>
        </header>

        <div className="wizard-body">
          <h3 className="wizard-step-title" ref={heading} tabIndex="-1">{editing && step === 'review' ? 'Na loja' : steps[stepIndex][1]}</h3>

          {step === 'basics' && <div className="wizard-fields">
            <label>Nome<input value={form.name} onChange={event => set('name', event.target.value)} required placeholder="Ex.: Camiseta Oversized Preta" maxLength={160} /></label>
            <fieldset className="wizard-categories">
              <legend>Categoria</legend>
              <div className="wizard-chips">
                {categories.map(item => <button key={item.id} type="button" aria-pressed={String(form.category_id) === String(item.id)} onClick={() => chooseCategory(item)}>{item.name}</button>)}
                <button type="button" aria-pressed={!form.category_id} onClick={() => chooseCategory(null)}>Sem categoria</button>
              </div>
            </fieldset>
            <div className="wizard-row">
              <div className="wizard-field">
                <label htmlFor={priceId}>Preço de venda</label>
                <span className="wizard-money"><span aria-hidden="true">R$</span><input id={priceId} type="number" inputMode="decimal" min="0" step="0.01" value={form.price} onChange={event => set('price', event.target.value)} placeholder="0,00" /></span>
              </div>
              <div className="wizard-field">
                <label htmlFor={costId}>Quanto você pagou (custo)</label>
                <span className="wizard-money"><span aria-hidden="true">R$</span><input id={costId} type="number" inputMode="decimal" min="0" step="0.01" value={form.cost} onChange={event => set('cost', event.target.value)} placeholder="0,00" aria-describedby={costHintId} /></span>
                <small id={costHintId}>Só aparece aqui no Admin, para calcular o lucro.</small>
              </div>
            </div>
            <label>Marca<input list={brandsId} value={form.brand} onChange={event => set('brand', event.target.value)} placeholder="Ex.: Nike, Adidas…" /></label>
            <datalist id={brandsId}>{brands.map(brand => <option key={brand} value={brand} />)}</datalist>
            <label>Descrição<textarea value={form.description} onChange={event => set('description', event.target.value)} rows="4" placeholder="Ex.: Malha 100% algodão, modelagem ampla. Lavar à mão." /></label>
          </div>}

          {step === 'photos' && (savedId
            ? <ProductPhotos productId={savedId} role={role} form={form} setForm={setForm} disabled={saving} onBusy={setUploading} />
            : <p className="wizard-note">Salve o básico do produto para enviar as fotos.</p>)}

          {step === 'sizes' && <div className="wizard-fields">
            <fieldset className="wizard-question">
              <legend>Esse produto tem tamanhos?</legend>
              <div className="wizard-segmented">
                <button type="button" aria-pressed={inventory.sizesEnabled} onClick={() => inventory.enableSizes(true)}>Sim, tem tamanhos</button>
                <button type="button" aria-pressed={!inventory.sizesEnabled} onClick={() => inventory.enableSizes(false)}>Não, tamanho único</button>
              </div>
            </fieldset>

            {inventory.sizesEnabled ? <section className="wizard-sizes" aria-label="Tamanhos e quantidades">
              <p className="wizard-hint">Toque nos tamanhos que você tem{categoryName ? ' (sugestões para ' + categoryName + ')' : ''} e informe quantas peças há de cada um.</p>
              <div className="wizard-chips" role="group" aria-label="Tamanhos mais comuns">
                {sizeSuggestions(categoryName).map(size => <button key={size} type="button" aria-pressed={inventory.hasSize(size)} onClick={() => inventory.hasSize(size) ? removeSuggested(size) : inventory.addSize(size)}>{size}</button>)}
              </div>
              <ul className="wizard-size-rows">
                {inventory.rows.map((row, index) => <li key={row._key} className={row.active ? undefined : 'is-inactive'}>
                  <input className="wizard-size-name" value={row.size} onChange={event => inventory.changeRow(row._key, 'size', event.target.value)} maxLength="40" required disabled={!row.active} aria-label={'Tamanho ' + (index + 1)} placeholder="Ex.: M" />
                  <Stepper hideLabel label={'Quantidade do tamanho ' + (String(row.size || '').trim() || index + 1)} value={row.stock} disabled={!row.active} onChange={value => inventory.changeRow(row._key, 'stock', value)} />
                  {row.active
                    ? <button type="button" className="text-button" onClick={() => setError(inventory.removeRow(row))}>{row.id ? 'Tirar da venda' : 'Remover'}</button>
                    : <button type="button" className="text-button" onClick={() => inventory.changeRow(row._key, 'active', true)}>Voltar a vender</button>}
                </li>)}
              </ul>
              <div className="wizard-size-add">
                <input value={newSize} onChange={event => setNewSize(event.target.value)} onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); addCustomSize() } }} aria-label="Outro tamanho" placeholder="Outro tamanho, ex.: 46" maxLength="40" />
                <button type="button" className="button button-ghost" onClick={addCustomSize}>Adicionar tamanho</button>
              </div>
              <strong className="wizard-total">Total: {inventory.total} unidade{inventory.total === 1 ? '' : 's'}</strong>
            </section> : <Stepper label="Quantidade em estoque" value={inventory.stock} onChange={inventory.setStock} />}

            <section className="wizard-package" aria-label="Embalagem para o frete">
              <h4>Embalagem para o frete</h4>
              {editingPackage ? <>
                <p className="wizard-hint">Peso e medidas de uma peça já embalada.</p>
                <div className="wizard-row wizard-row-4">
                  <label>Peso embalado (kg)<input type="number" inputMode="decimal" min="0.001" max="1000" step="0.001" value={form.shipping_weight} onChange={event => set('shipping_weight', event.target.value)} /></label>
                  <label>Largura da embalagem (cm)<input type="number" inputMode="decimal" min="0.01" max="1000" step="0.01" value={form.shipping_width} onChange={event => set('shipping_width', event.target.value)} /></label>
                  <label>Altura da embalagem (cm)<input type="number" inputMode="decimal" min="0.01" max="1000" step="0.01" value={form.shipping_height} onChange={event => set('shipping_height', event.target.value)} /></label>
                  <label>Comprimento da embalagem (cm)<input type="number" inputMode="decimal" min="0.01" max="1000" step="0.01" value={form.shipping_length} onChange={event => set('shipping_length', event.target.value)} /></label>
                </div>
                <button type="button" className="button button-ghost" onClick={() => setEditingPackage(false)}>Pronto</button>
              </> : packageComplete ? <p className="wizard-package-line"><span>{samePackage(form, suggestion) ? suggestion.label : 'Medidas informadas'} — {packageText(form)}</span><button type="button" className="text-button" onClick={() => setEditingPackage(true)}>Alterar</button></p>
                : <>
                  <p className="wizard-hint">Sem as medidas, o frete deste produto não é calculado no carrinho.</p>
                  <div className="wizard-package-actions">
                    <button type="button" className="button button-primary" onClick={() => setForm(current => withPackageDefaults({ ...current, ...Object.fromEntries(shippingKeys.map(key => [key, ''])) }, categoryName))}>Usar medidas sugeridas ({suggestion.label}: {packageText({ shipping_weight: suggestion.weight, shipping_width: suggestion.width, shipping_height: suggestion.height, shipping_length: suggestion.length })})</button>
                    <button type="button" className="button button-ghost" onClick={() => setEditingPackage(true)}>Informar medidas</button>
                  </div>
                </>}
            </section>

            <details className="wizard-more">
              <summary>Mais opções</summary>
              <label>Estoque mínimo<input type="number" inputMode="numeric" min="0" step="1" value={form.min_stock} onChange={event => set('min_stock', event.target.value)} /><small>O painel avisa quando o estoque chegar a esse número.</small></label>
            </details>
          </div>}

          {step === 'review' && <div className="wizard-review">
            <div className="wizard-preview" inert>
              <ProductCard product={{ id: savedId || 0, name: form.name || 'Nome do produto', category: categoryName, brand: form.brand, price: form.price, image: form.image }} />
            </div>
            <div className="wizard-review-side">
              <ul className="wizard-checks" aria-label="Conferência">
                {checks.map(check => <li key={check.text} className={check.ok ? 'is-ok' : check.required ? 'is-missing' : 'is-warning'}>
                  <span aria-hidden="true">{check.ok ? '✓' : check.required ? '✕' : '!'}</span>{check.text}
                </li>)}
              </ul>
              {editing && <fieldset className="wizard-question">
                <legend>Onde o produto aparece</legend>
                <div className="wizard-segmented">
                  <button type="button" aria-pressed={form.active} onClick={() => set('active', true)}>Na loja</button>
                  <button type="button" aria-pressed={!form.active} onClick={() => set('active', false)}>Rascunho</button>
                </div>
                <small>{form.active ? 'Os clientes veem e compram o produto.' : 'Fica guardado só no Admin, fora do catálogo.'}</small>
              </fieldset>}
            </div>
          </div>}

          {notice && <p className="wizard-note" role="status">{notice}</p>}
          {error && <div className="wizard-error" role="alert">
            {error}
            {inventory.conflict && <button type="button" className="button button-ghost" disabled={busy} onClick={refreshInventory}>{refreshing ? 'Atualizando quantidades…' : 'Atualizar quantidades'}</button>}
          </div>}
        </div>

        <footer className="wizard-footer">
          {editing ? <>
            <button type="button" className="button button-ghost" disabled={busy} onClick={onClose}>Fechar</button>
            <button type="submit" className="button button-primary" disabled={busy}>{uploading ? 'Enviando fotos…' : saving ? 'Salvando…' : 'Salvar produto'}</button>
          </> : <>
            {stepIndex > 0 && <button type="button" className="button button-ghost" disabled={busy} onClick={() => { setError(''); setStep(steps[stepIndex - 1][0]) }}>Voltar</button>}
            {step === 'review' ? <>
              <button type="button" className="button button-ghost" disabled={busy} onClick={() => finish(false)}>Deixar como rascunho</button>
              <button type="submit" className="button button-primary" disabled={busy}>{saving ? 'Publicando…' : 'Publicar na loja'}</button>
            </> : <button type="submit" className="button button-primary" disabled={busy}>{uploading ? 'Enviando fotos…' : saving ? 'Salvando…' : 'Continuar'}</button>}
          </>}
        </footer>
      </form>
    </div>
  )
}
