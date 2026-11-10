import { lazy, Suspense, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import gsap from 'gsap'
import { ScrollTrigger } from 'gsap/ScrollTrigger'
import { Link, Route, Routes, useLocation, useNavigate, useSearchParams } from 'react-router-dom'
import CampaignCarousel from './CampaignCarousel'
import RevealGrid from './RevealGrid'
import HeroVisual from './HeroVisual'
import NewsletterSignup, { NewsletterConfirmation } from './NewsletterSignup'
import VisualHomeEditor, { EditableSection, EditableText, EditorLink, EditorMediaButton, useVisualEditor } from './VisualHomeEditor'
import { cartCount, readCart, STORE_API_BASE } from './storeApi'
import { formatProductPrice, productHasPrice } from './productAvailability'
import { loadStorefrontJson } from './storefrontData'
import { editorialSegments, editorialType, textHighlightPath } from './editorialText'
import { useHeroTitleFit } from './useHeroTitleFit'
import { useLiteMode } from './liteMode'
import SiteHeader from './SiteHeader'
import SiteFooter from './SiteFooter'
import './site-chrome.css'
import './home.css'
import './catalog.css'
import ProductCard from './ProductCard'
import { CheckIcon, RefreshIcon, SearchIcon, ShieldIcon, SparkleIcon, StarIcon, TruckIcon } from './icons'

const AdminGate = lazy(() => import('./Admin'))
const ProductPage = lazy(() => import('./ProductPage'))
const CartPage = lazy(() => import('./CartPage'))
const AccountPage = lazy(() => import('./AccountPage'))
const MercadoPagoCheckout = lazy(() => import('./MercadoPagoCheckout'))
import { activeProductVariants, compareSizes } from './productVariants'
import './product-variants.css'
import { usePageMeta } from './pageMeta'
import { ResponsiveImage } from './ResponsiveImage'
import { imageWidths } from './cloudinaryImage'

const MALE_CATEGORIES = ['Camisetas', 'Calças', 'Camisas', 'Moletons', 'Bermudas', 'Casacos', 'Calçados', 'Acessórios']

const fallbackProducts = []

// The Home placeholder fills the screen so the footer stays below it and does
// not jump when the banner appears.
function PageLoading({ message = 'Carregando página…', minHeight = '70svh' }) {
  return <main className="section-shell page-space" style={{ minHeight }} aria-busy="true"><p className="page-note" role="status">{message}</p></main>
}

function RouteScroll() {
  const { pathname, hash } = useLocation()
  useLayoutEffect(() => {
    if (!hash) {
      window.scrollTo({ top:0, left:0, behavior:'instant' })
      return undefined
    }
    let target
    try { target = decodeURIComponent(hash.slice(1)) } catch { return undefined }
    const scroll = () => {
      const element = document.getElementById(target)
      if (!element) return false
      element.scrollIntoView({ block:'start', behavior:'instant' })
      return true
    }
    if (scroll()) return undefined
    const observer = new MutationObserver(() => { if (scroll()) observer.disconnect() })
    observer.observe(document.getElementById('root'), { childList:true, subtree:true })
    const timeout = window.setTimeout(() => observer.disconnect(), 5000)
    return () => { observer.disconnect(); window.clearTimeout(timeout) }
  }, [pathname, hash])
  return null
}

const boundedNumber = (value, fallback, min, max) => Number.isFinite(Number(value))
  ? Math.min(max, Math.max(min, Number(value))) : fallback

function StorefrontMotion({ homeSections, visualDefaults, campaignDefaults }) {
  const { pathname } = useLocation()
  const lite = useLiteMode()
  const introducedHeroes = useRef(new WeakSet())
  useLayoutEffect(() => {
    gsap.registerPlugin(ScrollTrigger)
    const root = document.querySelector('.app')
    const interaction = visualDefaults?.interaction || {}
    const smoothScroll = interaction.smooth_scroll || {}
    const reveal = interaction.scroll_reveal || {}
    const textReveal = interaction.hero_text_reveal || {}
    const campaignSection = homeSections.find((section) => section.key === 'campaigns')
    const campaign = { ...(campaignSection?.content?.defaults || {}), ...(campaignDefaults || {}) }
    const effect = ['static','zoom','pan-horizontal','pan-vertical','parallax','ken-burns'].includes(campaign.effect) ? campaign.effect : 'zoom'
    const header = root.querySelector('.site-header')
    const progressBar = root.querySelector('.scroll-progress')
    const updateScrollChrome = () => {
      const scroll = window.scrollY
      if (header) header.classList.toggle('is-scrolled', scroll > 24)
      if (!progressBar || lite) return
      const documentHeight = document.documentElement.scrollHeight - window.innerHeight
      const progress = documentHeight > 0 ? Math.min(1, Math.max(0, scroll / documentHeight)) : 0
      // Set on the bar itself: a custom property on <html> restyles the whole page.
      progressBar.style.setProperty('--scroll-progress', String(progress))
    }

    let scrollFrame = null
    const nativeScroll = () => {
      if (scrollFrame != null) return
      scrollFrame = window.requestAnimationFrame(() => {
        scrollFrame = null
        updateScrollChrome()
      })
    }
    window.addEventListener('scroll', nativeScroll, { passive:true })
    updateScrollChrome()

    let active = true
    let refreshFrame = null
    const refreshAfterLoad = () => {
      if (!active || refreshFrame != null) return
      refreshFrame = window.requestAnimationFrame(() => {
        refreshFrame = null
        if (active) {
          ScrollTrigger.refresh()
          updateScrollChrome()
        }
      })
    }
    root.addEventListener('load', refreshAfterLoad, true)
    root.addEventListener('loadedmetadata', refreshAfterLoad, true)
    document.fonts?.ready.then(refreshAfterLoad).catch(() => {})

    const media = gsap.matchMedia()
    // The light version keeps every element in place, without motion.
    if (!lite) media.add('(prefers-reduced-motion: no-preference)', () => {
      let lenis = null, raf = null, disposed = false
      // Smooth scrolling only changes the mouse wheel. Touch screens keep the
      // native scroll and never download it.
      if (smoothScroll.enabled !== false && window.matchMedia('(hover: hover) and (pointer: fine)').matches) {
        import('lenis').then(({ default: Lenis }) => {
          if (disposed) return
          lenis = new Lenis({
            duration: boundedNumber(smoothScroll.duration, 1.05, 0.1, 3),
            wheelMultiplier: boundedNumber(smoothScroll.wheel_multiplier, 0.95, 0.1, 3),
            smoothWheel: true,
            autoRaf: false
          })
          raf = (time) => lenis.raf(time * 1000)
          lenis.on('scroll', ScrollTrigger.update)
          gsap.ticker.add(raf)
          gsap.ticker.lagSmoothing(0)
        }).catch(() => {})
      }

      if (reveal.enabled !== false) gsap.utils.toArray('[data-reveal]').forEach((element) => {
        gsap.fromTo(
          element,
          { autoAlpha: 0, y: boundedNumber(reveal.distance, 24, 0, 100) },
          {
            autoAlpha: 1,
            y: 0,
            duration: boundedNumber(reveal.duration, 0.8, 0.1, 3),
            ease: 'power2.out',
            scrollTrigger: {
              trigger: element,
              start: 'top 86%',
              once: reveal.once !== false
            }
          }
        )
      })

      if (root.querySelector('.hero-full-content') && effect !== 'static') gsap.to('.hero-full-content', {
        y: () => window.innerWidth <= 760 ? -10 : -22,
        ease: 'none',
        scrollTrigger: {
          trigger: '.hero-full',
          start: 'top top',
          end: 'bottom top',
          scrub: true,
          invalidateOnRefresh: true
        }
      })

      const hero = root.querySelector('.hero-full')
      if (textReveal.enabled !== false && hero && !introducedHeroes.current.has(hero)) {
        const intro = gsap.timeline({
          onStart: () => introducedHeroes.current.add(hero),
          defaults: { ease: 'power3.out', clearProps: 'transform,opacity,visibility' }
        })
        intro.from('.hero-full .hero-title-mask', {
          autoAlpha: 0,
          y: 18,
          duration: boundedNumber(textReveal.duration, 0.9, 0.1, 3),
          stagger: boundedNumber(textReveal.stagger, 0.08, 0, 0.5)
        }, 0.08)
        intro.from('.hero-full p', { autoAlpha: 0, y: 12, duration: 0.65 }, 0.32)
        intro.from('.hero-full-actions', { autoAlpha: 0, y: 12, duration: 0.65 }, 0.44)
      }

      ScrollTrigger.refresh()
      return () => {
        disposed = true
        if (!lenis) return
        lenis.off('scroll', ScrollTrigger.update)
        gsap.ticker.remove(raf)
        lenis.destroy()
      }
    }, root)

    return () => {
      active = false
      if (refreshFrame != null) window.cancelAnimationFrame(refreshFrame)
      if (scrollFrame != null) window.cancelAnimationFrame(scrollFrame)
      root.removeEventListener('load', refreshAfterLoad, true)
      root.removeEventListener('loadedmetadata', refreshAfterLoad, true)
      media.revert()
      window.removeEventListener('scroll', nativeScroll)
    }
  }, [pathname, homeSections, visualDefaults, campaignDefaults, lite])

  return null
}

function homeSectionContent(sections, key, loaded = false) {
  const section = Array.isArray(sections) ? sections.find((item) => item.key === key) : null
  return { ...(section?.content || {}), __visible: section ? section.visible !== false : !loaded }
}

function EditorialTitle({ text, highlight, type = 'generic' }) {
  return editorialSegments(text, highlight, type).map((part, index) => part.type === 'break'
    ? <br key={index} />
    : part.type === 'highlight' ? <em className="editorial-highlight" key={index}>{part.text}</em> : part.text)
}

function HeroTitle({ text, highlight }) {
  if (highlight === undefined && text === 'Vista o que representa você') return <>
    <span className="hero-title-mask">Vista o que</span><br />
    <span className="hero-title-mask"><em className="editorial-highlight">representa você</em></span>
  </>
  return <span className="hero-title-mask"><EditorialTitle text={text} highlight={highlight} type="hero" /></span>
}

// Each benefit in the strip gets an icon chosen from its own text (CMS).
const utilityIcons = [[/envio|entrega|frete/i, TruckIcon], [/segur|pagamento|pix|cart[aã]o/i, ShieldIcon], [/nov[ao]s?\b|semana|lançamento/i, SparkleIcon], [/curadoria|marca|qualidade/i, StarIcon], [/troca|devolu/i, RefreshIcon]]
function UtilityIcon({ text }) {
  const Icon = utilityIcons.find(([pattern]) => pattern.test(String(text || '')))?.[1] || CheckIcon
  return <Icon className="utility-icon" />
}
const initialOf = value => (String(value || '').trim()[0] || '').toLocaleUpperCase('pt-BR')

function Home({ products = fallbackProducts, homeSections = [], homeLoaded = false, campaignDefaults, visualDefaults }) {
  usePageMeta('')
  const editor = useVisualEditor()
  const heroElement = useRef(null)
  const editing = Boolean(editor?.editing)
  const hero = homeSectionContent(homeSections, 'hero', homeLoaded)
  const utility = homeSectionContent(homeSections, 'utility', homeLoaded)
  const categorySection = homeSectionContent(homeSections, 'categories', homeLoaded)
  const featured = homeSectionContent(homeSections, 'featured_products', homeLoaded)
  const campaigns = homeSectionContent(homeSections, 'campaigns', homeLoaded)
  const manifesto = homeSectionContent(homeSections, 'manifesto', homeLoaded)
  const newsletter = homeSectionContent(homeSections, 'newsletter', homeLoaded)
  const text = (value, fallback) => typeof value === 'string' ? value : fallback
  const contents = { hero, utility, categories:categorySection, featured_products:featured, campaigns, manifesto, newsletter }
  const field = (key, path, label, value) => {
    const highlightPath = textHighlightPath(path)
    const highlight = highlightPath?.reduce((current, part) => current?.[part], contents[key])
    const children = key === 'hero' && path === 'title'
      ? <HeroTitle text={value} highlight={highlight} />
      : highlightPath ? <EditorialTitle text={value} highlight={highlight} type={editorialType(key, path)} /> : value
    return <EditableText sectionKey={key} path={path} label={label} value={value}>{children}</EditableText>
  }
  const shownProducts = featured?.source === 'manual' && Array.isArray(featured.product_ids)
    ? featured.product_ids.map(id => products.find(product => Number(product.id) === Number(id))).filter(Boolean).slice(0, 8)
    : products.slice(0, 8)
  const campaignItems = (Array.isArray(campaigns.items) ? campaigns.items : [
    { title:'Peças que marcam presença', button_label:'Descobrir agora', button_url:'/shop', media_url:'' },
    { title:'Seu estilo, sem rótulo', button_label:'Ver seleção', button_url:'/shop', media_url:'' },
    { title:'Feito para ser notado', button_label:'Explorar', button_url:'/shop', media_url:'' }
  ]).filter(item => item && typeof item === 'object' && !Array.isArray(item))
  const heroTitle = text(hero.title, 'Vista o que representa você')
  const heroDescription = text(hero.description, 'Curadoria de marcas, peças e estilos para quem não precisa seguir o mesmo caminho')
  useHeroTitleFit(heroElement, [heroTitle, hero.title_highlight, heroDescription, hero.description_highlight, editing, homeLoaded, hero.__visible])
  const categoryItems = Array.isArray(categorySection.items) ? categorySection.items : MALE_CATEGORIES.slice(0,3).map(title => ({ title, url:'/shop?category=' + encodeURIComponent(title) }))
  const effect = campaignDefaults?.effect || campaigns.defaults?.effect || 'zoom'
  const reveal = editing ? { enabled:false } : visualDefaults?.interaction?.scroll_reveal
  const defaultOrder = ['hero','utility','categories','featured_products','campaigns','manifesto','newsletter']
  const sections = {
    hero: (editing || hero.__visible !== false) && <section ref={heroElement} data-home-section="hero" className="hero-full section-shell" onClick={editing ? event => { if (!event.target.closest('button,a,[role="button"],textarea,input')) editor.select({sectionKey:'hero',kind:'media'}) } : undefined}>
      <div className="hero-full-media"><HeroVisual mediaUrl={hero.desktop_media_url || ''} mobileUrl={hero.mobile_media_url || ''} videoUrl={hero.video_media_url || ''} effect={effect} speed={campaignDefaults?.speed ?? campaigns.defaults?.speed ?? 'slow'} durationSeconds={campaignDefaults?.duration_seconds ?? campaigns.defaults?.duration_seconds ?? 6} editorPaused={editing} /><div className="hero-full-shade" /></div>
      <EditorMediaButton sectionKey="hero" label="Trocar imagem ou vídeo do Hero" />
      <div className="hero-full-content">
        {hero.eyebrow && <span className="hero-eyebrow">{field('hero','eyebrow','Selo do Hero',text(hero.eyebrow,''))}</span>}
        <h1 className="hero-title"><span className="hero-title-line">{field('hero','title','Título do Hero',heroTitle)}</span></h1>
        <p>{field('hero','description','Descrição do Hero',heroDescription)}</p>
        <div className="hero-full-actions"><EditorLink sectionKey="hero" labelPath="button_label" urlPath="button_url" className="button button-primary" to={hero.button_url || '/shop'}>{text(hero.button_label,'Explorar coleção')} <span>↗</span></EditorLink>{!editing && (hero.button_url || '/shop') !== '/shop' && <Link className="button button-ghost hero-secondary" to="/shop">Ver catálogo</Link>}</div>
      </div>
    </section>,
    utility: (editing || utility.__visible !== false) && <section data-home-section="utility" className="utility-strip section-shell" aria-label="Diferenciais">
      {(Array.isArray(utility.items) ? utility.items : ['Curadoria multimarcas','Compra segura','Envio para todo o Brasil','Novas peças toda semana']).map((item,index) => <span key={index}><UtilityIcon text={item} />{field('utility',['items',index],'Mensagem ' + (index + 1),item)}</span>)}
    </section>,
    categories: (editing || categorySection.__visible !== false) && <section data-home-section="categories" className="section-shell section-block">
      <div className="section-heading row-heading" data-reveal><div><h2>{field('categories','title','Título das categorias',text(categorySection.title,'Escolha seu movimento'))}</h2></div><EditorLink sectionKey="categories" labelPath="button_label" urlPath="button_url" className="text-link" to={categorySection.button_url || '/shop'}>{text(categorySection.button_label,'Ver catálogo')} ↗</EditorLink></div>
      <RevealGrid className="category-grid" items={categoryItems} reveal={reveal}>{categoryItems.map((item,index) => {
        const content = <>{item.media_url && <ResponsiveImage className="category-media" src={item.media_url} widths={imageWidths.card} sizes="(max-width: 700px) 50vw, 25vw" alt="" loading="lazy" decoding="async" />}<strong>{field('categories',['items',index,'title'],'Nome da categoria ' + (index + 1),text(item.title,'Categoria'))}</strong><small>Explorar ↗</small></>
        const className = 'category-card category-card-' + (index % 3) + (item.media_url ? ' has-media' : '')
        const initial = initialOf(text(item.title,'Categoria'))
        return editing ? <article key={item.id || index} className={className} data-initial={initial} onClick={() => editor.select({sectionKey:'categories',kind:'category',itemIndex:index})}>{content}<EditorMediaButton sectionKey="categories" kind="category" itemIndex={index} label={'Editar categoria ' + (index + 1)} /></article> : <Link key={item.id || index} className={className} data-initial={initial} data-editor-spa-link={editor ? 'true' : undefined} to={item.url || '/shop'}>{content}</Link>
      })}</RevealGrid>
    </section>,
    featured_products: (editing || featured.__visible !== false) && (editing || shownProducts.length > 0) && <section data-home-section="featured_products" className="section-shell section-block featured-selection" id="destaques">
      <div className="section-heading row-heading" data-reveal><div><h2>{field('featured_products','title','Título dos destaques',text(featured.title,'Seleção multimarcas'))}</h2></div><EditorLink sectionKey="featured_products" labelPath="button_label" urlPath="button_url" className="text-link" to={featured.button_url || '/shop'}>{text(featured.button_label,'Ver todos')} ↗</EditorLink></div>
      <EditorMediaButton sectionKey="featured_products" kind="products" label="Escolher produtos em destaque" />
      <RevealGrid className="product-grid product-grid-editorial" items={shownProducts} reveal={reveal}>{shownProducts.map((product,index) => <ProductCard key={product.id || index} product={product} />)}</RevealGrid>
      {editing && shownProducts.length === 0 && <p className="visual-editor-empty">Escolha os produtos que aparecerão nesta seção.</p>}
    </section>,
    campaigns: (editing || campaigns.__visible !== false) && <RevealGrid as="section" data-home-section="campaigns" className="section-shell campaign-grid" aria-label="Campanhas" items={campaignItems} reveal={reveal}>
      {campaignItems.map((item,index) => <article className={index === 0 ? 'campaign-card campaign-card-wide' : 'campaign-card'} key={index}>
        <CampaignCarousel item={item} variant={index + 1} defaults={campaignDefaults} sectionDefaults={campaigns.defaults} editorPaused={editing} editorNavigation={Boolean(editor)} onEdit={() => editor?.select({ sectionKey:'campaigns',kind:'campaign',itemIndex:index })}>
          <div className="campaign-card-copy">
            <strong>{field('campaigns',['items',index,'title'],'Título da campanha ' + (index + 1),text(item.title,'Nova campanha'))}</strong>
            <small>{field('campaigns',['items',index,'button_label'],'Texto do botão da campanha ' + (index + 1),text(item.button_label,'Explorar'))} ↗</small>
          </div>
        </CampaignCarousel>
        <EditorMediaButton sectionKey="campaigns" kind="campaign" itemIndex={index} label={'Editar fotos e link da campanha ' + (index + 1)} />
      </article>)}
      {editing && campaignItems.length === 0 && <p className="visual-editor-empty">Use “Opções” da seção para adicionar a primeira campanha.</p>}
    </RevealGrid>,
    manifesto: (editing || manifesto.__visible !== false) && <section data-home-section="manifesto" className="manifesto section-shell" id="sobre" data-reveal>
      <p>{field('manifesto','text','Texto do manifesto',text(manifesto.text,'Não seguimos o padrão\nCriamos o nosso'))}</p>
    </section>,
    newsletter: (editing || newsletter.__visible !== false) && <section data-home-section="newsletter" className="newsletter section-shell" data-reveal>
      <div>{newsletter.eyebrow && <span className="section-eyebrow">{field('newsletter','eyebrow','Selo da newsletter',text(newsletter.eyebrow,''))}</span>}<h2>{field('newsletter','title','Título da newsletter',text(newsletter.title,'Entre para a próxima fase'))}</h2></div>
      {editing ? <div className="newsletter-signup"><div className="visual-editor-newsletter"><input type="email" placeholder="Seu melhor e-mail" aria-label="Prévia do campo de e-mail" disabled /><span>{field('newsletter','button_label','Texto do botão da newsletter',text(newsletter.button_label,'Entrar'))} ↗</span></div><small>Prévia do formulário de novidades</small></div> : <NewsletterSignup buttonLabel={text(newsletter.button_label,'Entrar')} />}
    </section>
  }
  const orderedKeys = homeLoaded ? [...homeSections].sort((a,b) => Number(a.order || 0) - Number(b.order || 0)).map(section => section.key).filter(key => defaultOrder.includes(key)) : defaultOrder
  return <main>{orderedKeys.map(key => <EditableSection key={key} sectionKey={key}>{sections[key]}</EditableSection>)}</main>
}

function StorefrontMotionGate(props) {
  const editor = useVisualEditor()
  return editor?.editing ? null : <StorefrontMotion {...props} />
}

// Unknown addresses used to render an empty page. The SPA cannot send HTTP 404,
// so the page asks search engines not to index it.
function NotFound() {
  usePageMeta('Página não encontrada')
  useEffect(() => {
    const robots = document.createElement('meta')
    robots.name = 'robots'
    robots.content = 'noindex'
    document.head.append(robots)
    return () => robots.remove()
  }, [])
  return <main className="section-shell page-space not-found-page">
    <h1>Página não encontrada</h1>
    <p>Este endereço não existe ou mudou de lugar.</p>
    <div className="not-found-actions">
      <Link className="button button-primary" to="/shop">Ver catálogo ↗</Link>
      <Link className="text-link" to="/">Voltar ao início</Link>
    </div>
  </main>
}

const normalizeSearchText = (value) => String(value || '')
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '')
  .toLowerCase()
  .trim()

function Shop({ products = fallbackProducts, categories = [], visualDefaults }) {
  usePageMeta('Catálogo')
  const [searchParams, setSearchParams] = useSearchParams()
  const selectedCategory = searchParams.get('category') || 'Todos'
  const selectedBrand = searchParams.get('brand') || ''
  const selectedSize = searchParams.get('size') || ''
  const onlyAvailable = searchParams.get('stock') === 'available'
  const query = searchParams.get('q') || ''
  const [searchInput, setSearchInput] = useState(query)
  const [sort, setSort] = useState('latest')
  const availableBrands = useMemo(() => [...new Set(products.map(product => String(product.brand || '').trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'pt-BR')), [products])
  const availableSizes = useMemo(() => [...new Set(products.flatMap(product => activeProductVariants(product).filter(variant => Number(variant.stock) > 0).map(variant => variant.size)))].sort(compareSizes), [products])

  useEffect(() => {
    setSearchInput(query)
  }, [query])

  const availableCategories = useMemo(() => MALE_CATEGORIES.map((name, index) => (
    categories.find(category => normalizeSearchText(category.name) === normalizeSearchText(name)) || {
      id: 'catalog-' + index,
      name,
      sort_order: (index + 1) * 10
    }
  )), [categories])

  const filteredProducts = useMemo(() => {
    const normalizedQuery = normalizeSearchText(query)

    const result = products.filter((product) => {
      const categoryMatch = selectedCategory === 'Todos' || normalizeSearchText(product?.category) === normalizeSearchText(selectedCategory)
      if (!categoryMatch) return false
      if (selectedBrand && normalizeSearchText(product.brand) !== normalizeSearchText(selectedBrand)) return false
      if (selectedSize && !activeProductVariants(product).some(variant => normalizeSearchText(variant.size) === normalizeSearchText(selectedSize) && Number(variant.stock) > 0)) return false
      if (onlyAvailable && Number(product.stock) < 1) return false
      if (!normalizedQuery) return true

      const haystack = [
        product?.name,
        product?.brand,
        product?.category,
        product?.description
      ].map(normalizeSearchText).join(' ')

      return haystack.includes(normalizedQuery)
    })

    return [...result].sort((a, b) => {
      if (sort === 'size-asc' || sort === 'size-desc') {
        const sizeOf = product => activeProductVariants(product).filter(variant => Number(variant.stock) > 0).map(variant => variant.size).sort(compareSizes)[0]
        const aSize = sizeOf(a), bSize = sizeOf(b)
        if (Boolean(aSize) !== Boolean(bSize)) return aSize ? -1 : 1
        if (aSize && bSize) return compareSizes(aSize, bSize) * (sort === 'size-desc' ? -1 : 1)
      }
      if (sort === 'price-asc' || sort === 'price-desc') {
        if (productHasPrice(a) !== productHasPrice(b)) return productHasPrice(a) ? -1 : 1
      }
      if (sort === 'price-asc') return Number(a.price || 0) - Number(b.price || 0)
      if (sort === 'price-desc') return Number(b.price || 0) - Number(a.price || 0)
      if (sort === 'name') return String(a.name || '').localeCompare(String(b.name || ''), 'pt-BR')
      if (sort === 'name-desc') return String(b.name || '').localeCompare(String(a.name || ''), 'pt-BR')
      if (sort === 'brand') return String(a.brand || '').localeCompare(String(b.brand || ''), 'pt-BR')
      if (sort === 'stock-desc') return Number(b.stock || 0) - Number(a.stock || 0)
      return Number(b.id || 0) - Number(a.id || 0)
    })
  }, [products, selectedCategory, selectedBrand, selectedSize, onlyAvailable, query, sort])

  function selectRefinement(key, value) {
    const next = new URLSearchParams(searchParams)
    if (value) next.set(key, value)
    else next.delete(key)
    setSearchParams(next)
  }

  function selectCategory(category) {
    const next = new URLSearchParams(searchParams)
    if (category === 'Todos') next.delete('category')
    else next.set('category', category)
    setSearchParams(next)
  }

  function submitSearch(event) {
    event.preventDefault()
    const value = searchInput.trim()
    const next = new URLSearchParams(searchParams)
    if (value) next.set('q', value)
    else next.delete('q')
    setSearchParams(next)
  }

  function clearSearch() {
    const next = new URLSearchParams(searchParams)
    next.delete('q')
    setSearchInput('')
    setSearchParams(next)
  }

  return (
    <main className="section-shell page-space catalog-page">
      <div className="page-heading" data-reveal>
        <span className="section-eyebrow">Catálogo</span>
        <h1>Descubra<br /><em>seu próximo kit</em></h1>
      </div>

      <div className="catalog-toolbar">
        <form className="catalog-search" role="search" onSubmit={submitSearch} data-reveal>
          <div className="catalog-search-field">
            <SearchIcon />
            <input
              value={searchInput}
              onChange={(event) => setSearchInput(event.target.value)}
              placeholder="Buscar produto, marca ou categoria"
              aria-label="Buscar produto, marca ou categoria"
            />
            {searchInput && (
              <button type="button" className="catalog-search-clear" onClick={clearSearch} aria-label="Limpar busca">×</button>
            )}
          </div>
          <button type="submit">Buscar ↗</button>
        </form>

        <div className="catalog-summary" aria-live="polite">
          <span>{filteredProducts.length} produto(s)</span>
          {query && <strong>Busca: “{query}”</strong>}
        </div>
      </div>

      <div className="filters" role="group" aria-label="Categorias" data-reveal>
        <button
          type="button"
          className={selectedCategory === 'Todos' ? 'filter-active' : ''}
          aria-pressed={selectedCategory === 'Todos'}
          onClick={() => selectCategory('Todos')}
        >
          Todos
        </button>
        {availableCategories.map((category) => {
          const active = normalizeSearchText(selectedCategory) === normalizeSearchText(category.name)
          return (
            <button
              type="button"
              key={category.id}
              className={active ? 'filter-active' : ''}
              aria-pressed={active}
              onClick={() => selectCategory(category.name)}
            >
              {category.name}
            </button>
          )
        })}
      </div>

      <div className="catalog-refinements">
        <label className="catalog-sort">
          <span>Ordenar</span>
          <select value={sort} onChange={(event) => setSort(event.target.value)} aria-label="Ordenar produtos">
            <option value="latest">Mais recentes</option>
            <option value="name">Nome</option>
            <option value="name-desc">Nome: Z a A</option>
            <option value="brand">Marca</option>
            <option value="price-asc">Menor preço</option>
            <option value="price-desc">Maior preço</option>
            <option value="stock-desc">Maior disponibilidade</option>
            <option value="size-asc">Tamanho: menor ao maior</option>
            <option value="size-desc">Tamanho: maior ao menor</option>
          </select>
        </label>
        <label>Marca<select aria-label="Filtrar por marca" value={selectedBrand} onChange={event => selectRefinement('brand', event.target.value)}><option value="">Todas</option>{availableBrands.map(brand => <option key={brand} value={brand}>{brand}</option>)}</select></label>
        <label>Tamanho<select aria-label="Filtrar por tamanho" value={selectedSize} onChange={event => selectRefinement('size', event.target.value)} disabled={!availableSizes.length && !selectedSize}><option value="">Todos</option>{selectedSize && !availableSizes.includes(selectedSize) && <option value={selectedSize}>{selectedSize}</option>}{availableSizes.map(size => <option key={size} value={size}>{size}</option>)}</select></label>
        <label>Disponibilidade<select aria-label="Filtrar por disponibilidade" value={onlyAvailable ? 'available' : ''} onChange={event => selectRefinement('stock', event.target.value)}><option value="">Todos</option><option value="available">Com estoque</option></select></label>
      </div>

      {filteredProducts.length > 0 ? (
        <RevealGrid className="product-grid" items={filteredProducts} reveal={visualDefaults?.interaction?.scroll_reveal}>
          {filteredProducts.map((product) => <ProductCard key={product.id} product={product} />)}
        </RevealGrid>
      ) : (
        <div className="empty-catalog" data-reveal>
          <h2>Nada encontrado.</h2>
          <p>Tente outra busca ou escolha uma categoria diferente.</p>
          <button type="button" className="button button-primary" onClick={() => {
            setSearchInput('')
            setSearchParams({})
          }}>
            Limpar filtros ↗
          </button>
        </div>
      )}
    </main>
  )
}

function PlaceholderPage({ title }) {
  return (
    <main className="section-shell page-space">
      <h1>{title}</h1>
      <p className="page-note">Estrutura preparada para a próxima etapa do projeto.</p>
    </main>
  )
}

export default function App() {
  const { pathname, key:visitKey } = useLocation()
  const adminRoute = /^\/admin(?:\/|$)/i.test(pathname)
  const previewMode = new URLSearchParams(window.location.search).get('preview') === 'draft'
  const visualMode = previewMode && pathname === '/' && new URLSearchParams(window.location.search).get('edit') === '1'
  const [previewDenied, setPreviewDenied] = useState(false)
  const [themePreference, setThemePreference] = useState(() => {
    if (visualMode) return null
    const requestedTheme = new URLSearchParams(window.location.search).get('theme')
    if (requestedTheme === 'light' || requestedTheme === 'dark') return requestedTheme
    try {
      const savedTheme = localStorage.getItem('galeo-theme')
      return savedTheme === 'light' || savedTheme === 'dark' ? savedTheme : null
    } catch { return null }
  })
  const [catalog, setCatalog] = useState([])
  const [categories, setCategories] = useState([])
  const [catalogError, setCatalogError] = useState('')
  const [homeSections, setHomeSections] = useState([])
  const [homeLoaded, setHomeLoaded] = useState(false)
  const [homeSource, setHomeSource] = useState(null)
  const [homeVisit, setHomeVisit] = useState(null)
  const [homeError, setHomeError] = useState('')
  const [homeAttempt, setHomeAttempt] = useState(0)
  const [siteSettings, setSiteSettings] = useState({})
  const [settingsLoaded, setSettingsLoaded] = useState(false)
  const [settingsSource, setSettingsSource] = useState(null)
  const defaultTheme = siteSettings.storefront_visual_defaults?.theme
  const theme = themePreference || (defaultTheme === 'light' ? 'light' : 'dark')
  const [cartItemsCount, setCartItemsCount] = useState(() => cartCount(readCart()))
  const needsCatalog = !adminRoute && (pathname === '/' || pathname === '/shop')
  const needsHome = !adminRoute && pathname === '/'
  const homeVisitKey = needsHome ? (previewMode ? 'draft:' : 'published:') + visitKey : null
  const homeReady = homeLoaded && homeVisit === homeVisitKey && homeSource === (previewMode ? 'draft' : 'published')

  useEffect(() => {
    const syncCart = () => setCartItemsCount(cartCount(readCart()))
    window.addEventListener('galeo-cart-updated', syncCart)
    return () => window.removeEventListener('galeo-cart-updated', syncCart)
  }, [])

  useEffect(() => {
    if (!needsCatalog) return undefined
    let active = true
    async function loadCatalog() {
      setCatalogError('')
      const catalogPath = '/api/store'
      const endpoints = [...new Set([STORE_API_BASE + catalogPath, catalogPath])]
      for (const endpoint of endpoints) {
        try {
          const data = await loadStorefrontJson(endpoint)
          if (!active) return
          setCatalog(Array.isArray(data?.products) ? data.products : [])
          setCategories(Array.isArray(data?.categories) ? data.categories : [])
          return
        } catch {}
      }
      if (active) {
        setCatalog([])
        setCategories([])
        setCatalogError('Não foi possível carregar o catálogo agora.')
      }
    }
    loadCatalog()
    return () => { active = false }
  }, [needsCatalog])

  useEffect(() => {
    // When leaving the owner preview, replace its in-memory data with the public
    // document too. Ordinary catalog/product visits do not fetch the Home.
    if (!needsHome && (previewMode || homeSource !== 'draft' || adminRoute)) return undefined
    let active = true
    const source = previewMode ? 'draft' : 'published'
    setHomeError('')
    setHomeLoaded(false)
    if (previewMode) setPreviewDenied(false)
    async function loadHome() {
      try {
        const data = await loadStorefrontJson(previewMode ? '/api/admin/home' : '/api/store/home', { credentials:'include' })
        if (!active) return
        const sections = Array.isArray(data?.sections) ? data.sections : []
        setHomeSections(previewMode ? sections.map(section => ({ ...section, content:section.draft })) : sections)
        setHomeSource(source)
        setHomeVisit(homeVisitKey)
        setHomeLoaded(true)
      } catch {
        if (!active) return
        if (previewMode) setPreviewDenied(true)
        else setHomeError('Não foi possível carregar a página inicial. Tente novamente.')
      }
    }
    loadHome()
    return () => { active = false }
  }, [homeVisitKey, previewMode, homeAttempt])

  useEffect(() => {
    if (adminRoute) return undefined
    let active = true
    setSettingsLoaded(false)
    loadStorefrontJson(previewMode ? '/api/admin/home/settings' : '/api/store/home/settings', { credentials:'include' })
      .then(data => {
        if (active) {
          setSiteSettings(Object.fromEntries((Array.isArray(data?.settings) ? data.settings : []).map(item => [item.key, item.value])))
          setSettingsSource(previewMode ? 'draft' : 'published')
          setSettingsLoaded(true)
        }
      })
      .catch(() => { if (active && previewMode) setPreviewDenied(true) })
    return () => { active = false }
  }, [adminRoute, previewMode])

  useEffect(() => {
    document.documentElement.dataset.theme = theme
    if (themePreference) {
      try { localStorage.setItem('galeo-theme', themePreference) } catch {}
    }
  }, [theme, themePreference])

  useEffect(() => {
    const palette = siteSettings.storefront_visual_defaults?.palette || {}
    const root = document.documentElement
    const vars = { background:'--bg', surface:'--surface', surface_alt:'--surface-2', text:'--text', muted:'--muted', accent:'--accent', accent_soft:'--accent-soft', accent_deep:'--accent-deep', line:'--line' }

    if (theme === 'light') {
      Object.values(vars).forEach((cssVar) => root.style.removeProperty(cssVar))
      return
    }

    Object.entries(vars).forEach(([key, cssVar]) => {
      if (palette[key]) root.style.setProperty(cssVar, palette[key])
    })
  }, [siteSettings, theme])

  const storefront = (
    <div className="app">
      <RouteScroll />
      {!adminRoute && <div className="scroll-progress" aria-hidden="true"><span /></div>}
      {!adminRoute && catalogError && <div className="catalog-global-error" role="status">{catalogError}</div>}
      {previewDenied && previewMode && (
        <div className="draft-preview-denied" role="alert">
          <strong>Pré-visualização indisponível</strong>
          <span>Abra esta visualização enquanto estiver conectado ao painel administrativo como proprietário</span>
        </div>
      )}
      {previewMode && !visualMode && !previewDenied && (
        <div className="draft-preview-bar" role="status">
          <span><strong>RASCUNHO</strong> esta versão ainda não está publicada</span>
          <a href="/admin?tab=editor">Voltar ao editor</a>
          <a href="/?preview=draft&edit=1">Editar nesta página</a>
        </div>
      )}

      {!adminRoute && (!needsHome || homeReady) && <StorefrontMotionGate homeSections={homeSections} visualDefaults={siteSettings.storefront_visual_defaults} campaignDefaults={siteSettings.campaign_defaults} />}
      {!adminRoute && <SiteHeader
        theme={theme}
        navigation={siteSettings.navigation}
        cartItemsCount={cartItemsCount}
        onToggle={() => setThemePreference(theme === 'dark' ? 'light' : 'dark')}
      />}
      <Suspense fallback={<PageLoading />}><Routes>
        <Route path="/admin/*" element={<AdminGate />} />
        <Route path="/" element={homeReady ? <Home products={catalog} homeSections={homeSections} homeLoaded={homeLoaded} campaignDefaults={siteSettings.campaign_defaults} visualDefaults={siteSettings.storefront_visual_defaults} /> : homeError ? <main className="section-shell page-space" style={{ minHeight:'70svh' }}><p className="page-note" role="alert">{homeError}</p><button type="button" className="button button-primary" onClick={() => setHomeAttempt(attempt => attempt + 1)}>Tentar novamente</button></main> : <PageLoading message="Carregando loja…" minHeight="100svh" />} />
        <Route path="/shop" element={<Shop products={catalog} categories={categories} visualDefaults={siteSettings.storefront_visual_defaults} />} />
        <Route path="/produto/:id" element={<ProductPage />} />
        <Route path="/conta" element={<AccountPage />} />
        <Route path="/newsletter" element={<NewsletterConfirmation />} />
        <Route path="/carrinho" element={<CartPage />} />
        <Route path="/pagamento/:orderId" element={<MercadoPagoCheckout />} />
        <Route path="*" element={<NotFound />} />
      </Routes></Suspense>
      {!adminRoute && <SiteFooter footer={siteSettings.footer} navigation={siteSettings.navigation} />}
    </div>
  )
  if (!visualMode) return storefront
  if (previewDenied) return <main className="section-shell page-space"><h1>Editor indisponível</h1><p role="alert">Entre no painel com a conta de proprietário para editar o rascunho.</p><a className="button button-primary" href="/admin">Entrar no painel</a></main>
  if (!homeReady || !settingsLoaded || settingsSource !== 'draft') return <main className="section-shell page-space"><p role="status">Carregando o rascunho da loja…</p></main>
  return <VisualHomeEditor sections={homeSections} settings={siteSettings} products={catalog} categories={categories} onSectionsChange={setHomeSections} onSettingsChange={next => { setThemePreference(null); setSiteSettings(next) }}>{storefront}</VisualHomeEditor>
}
