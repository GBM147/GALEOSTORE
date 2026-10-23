import { CAMPAIGN_DEFAULTS, MAX_CAMPAIGN_SLIDES, isCampaignVideo } from './campaign-model'

const effects = [['static','Nenhum'],['zoom','Zoom suave'],['pan-horizontal','Movimento horizontal'],['pan-vertical','Movimento vertical'],['parallax','Parallax'],['ken-burns','Ken Burns']]
const transitions = [['fade','Fade'],['slide','Slide'],['crossfade','Crossfade']]
const speeds = [['slow','Lenta'],['normal','Normal'],['fast','Rápida']]
const mediaType = (url) => isCampaignVideo(url) ? 'video' : 'image'
const setSlides = (item, slides) => ({ ...item, media_id:null, media_url:'', video_media_id:null, video_media_url:'', mobile_media_id:null, mobile_media_url:'', mobile_video_media_id:null, mobile_video_media_url:'', slides })

function slidesFor(item) {
  return Array.isArray(item.slides) && item.slides.length ? item.slides : [{
    media_id:item.media_id || null, media_url:item.video_media_url || item.media_url || '',
    media_type:item.video_media_url ? 'video' : (item.media_type || mediaType(item.media_url)),
    mobile_media_id:item.mobile_media_id || null, mobile_media_url:item.mobile_video_media_url || item.mobile_media_url || '',
    mobile_media_type:item.mobile_video_media_url ? 'video' : (item.mobile_media_type || mediaType(item.mobile_media_url))
  }]
}

export default function HomeCampaignEditor({ draft, mediaItems, defaults, onChange, onAdd, onRemove, onMove }) {
  const defaultAnimation = defaults || CAMPAIGN_DEFAULTS
  return <div className="home-editor-list">
    <p className="home-workflow-help">Cada campanha pode alternar entre fotos ou vídeos. O padrão da GALEO já aplica o movimento e a transição.</p>
    {(draft.items || []).map((item, index) => {
      const slides = slidesFor(item)
      const animation = item.animation || { use_default:true }
      const useDefault = animation.use_default !== false
      function changeSlide(slideIndex, fields) {
        onChange(index, setSlides(item, slides.map((slide, currentIndex) => currentIndex === slideIndex ? { ...slide, ...fields } : slide)))
      }
      function selectMedia(slideIndex, prefix, id) {
        const asset = mediaItems.find((file) => Number(file.id) === Number(id))
        changeSlide(slideIndex, { [prefix + 'media_id']:asset ? Number(asset.id) : null, [prefix + 'media_url']:asset?.url || '', [prefix + 'media_type']:asset?.media_type || 'image', [prefix + 'video_media_url']:'', [prefix + 'video_media_id']:null })
      }
      function moveSlide(slideIndex, direction) {
        const next = slideIndex + direction
        if (next < 0 || next >= slides.length) return
        const moved = [...slides]
        ;[moved[slideIndex], moved[next]] = [moved[next], moved[slideIndex]]
        onChange(index, setSlides(item, moved))
      }
      return <div className="home-editor-card-row" key={index}>
        <h3 className="home-campaign-title">Campanha {index + 1}</h3>
        <div className="home-editor-card-grid">
          <label>Título<input value={item.title || ''} onChange={(event) => onChange(index, { ...item, title:event.target.value })} /></label>
          <label>Texto do botão<input value={item.button_label || ''} onChange={(event) => onChange(index, { ...item, button_label:event.target.value })} /></label>
          <label>Destino do botão<input value={item.button_url || ''} onChange={(event) => onChange(index, { ...item, button_url:event.target.value })} /></label>
        </div>
        {slides.map((slide, slideIndex) => <section className="home-campaign-slide" aria-label={'Campanha ' + (index + 1) + ', foto ' + (slideIndex + 1)} key={slideIndex}>
          <h4>Foto / vídeo {slideIndex + 1}</h4>
          <div className="home-editor-card-grid">
            <label>Mídia desktop<select aria-label="Mídia desktop" value={slide.media_id || ''} onChange={(event) => selectMedia(slideIndex, '', event.target.value)}><option value="">Escolher na biblioteca</option>{mediaItems.map((asset) => <option key={asset.id} value={asset.id}>{asset.title || (asset.media_type === 'video' ? 'Vídeo' : 'Imagem')}</option>)}</select><input value={slide.media_url || ''} aria-label={'Link da mídia desktop ' + (slideIndex + 1)} placeholder="Ou cole o link da mídia" onChange={(event) => changeSlide(slideIndex, { media_url:event.target.value, media_id:null, media_type:mediaType(event.target.value), video_media_url:'', video_media_id:null })} /></label>
            <label>Mídia mobile<select aria-label="Mídia mobile" value={slide.mobile_media_id || ''} onChange={(event) => selectMedia(slideIndex, 'mobile_', event.target.value)}><option value="">Usar a mídia desktop</option>{mediaItems.map((asset) => <option key={asset.id} value={asset.id}>{asset.title || (asset.media_type === 'video' ? 'Vídeo' : 'Imagem')}</option>)}</select><input value={slide.mobile_media_url || ''} aria-label={'Link da mídia mobile ' + (slideIndex + 1)} placeholder="Opcional: link para celular" onChange={(event) => changeSlide(slideIndex, { mobile_media_url:event.target.value, mobile_media_id:null, mobile_media_type:mediaType(event.target.value), mobile_video_media_url:'', mobile_video_media_id:null })} /></label>
          </div>
          <div className="home-editor-row-actions"><button type="button" aria-label={'Mover foto ' + (slideIndex + 1) + ' para cima'} disabled={slideIndex === 0} onClick={() => moveSlide(slideIndex, -1)}>↑</button><button type="button" aria-label={'Mover foto ' + (slideIndex + 1) + ' para baixo'} disabled={slideIndex === slides.length - 1} onClick={() => moveSlide(slideIndex, 1)}>↓</button><button type="button" aria-label={'Remover foto ' + (slideIndex + 1)} disabled={slides.length === 1} onClick={() => onChange(index, setSlides(item, slides.filter((_, currentIndex) => currentIndex !== slideIndex)))}>Remover foto</button></div>
        </section>)}
        <button className="text-button" type="button" disabled={slides.length >= MAX_CAMPAIGN_SLIDES} onClick={() => onChange(index, setSlides(item, [...slides, { media_url:'', media_type:'image', mobile_media_url:'' }]))}>+ adicionar foto / vídeo</button>
        <div className="home-campaign-animation">
          <label className="home-campaign-default-label"><input type="checkbox" checked={useDefault} onChange={(event) => onChange(index, { ...item, animation:{ ...defaultAnimation, ...animation, use_default:event.target.checked } })} />Usar padrão da GALEO</label>
          {useDefault ? <p className="home-workflow-help">{effects.find(([value]) => value === defaultAnimation.effect)?.[1] || 'Zoom suave'} · {transitions.find(([value]) => value === defaultAnimation.transition)?.[1] || 'Crossfade'} · {speeds.find(([value]) => value === defaultAnimation.speed)?.[1] || 'Lenta'} · {defaultAnimation.duration_seconds || 6} segundos</p> : <div className="home-editor-card-grid">
            {[['effect','Movimento',effects],['transition','Transição',transitions],['speed','Velocidade',speeds]].map(([key, label, options]) => <label key={key}>{label}<select aria-label={label} value={animation[key] || defaultAnimation[key]} onChange={(event) => onChange(index, { ...item, animation:{ ...animation, [key]:event.target.value } })}>{options.map(([value, text]) => <option key={value} value={value}>{text}</option>)}</select></label>)}
            <label>Duração (segundos)<input type="number" min="2" max="30" value={animation.duration_seconds ?? defaultAnimation.duration_seconds} onChange={(event) => onChange(index, { ...item, animation:{ ...animation, duration_seconds:Number(event.target.value) } })} /></label>
          </div>}
        </div>
        <div className="home-editor-row-actions"><button type="button" aria-label={'Mover campanha ' + (index + 1) + ' para cima'} disabled={index === 0} onClick={() => onMove(index, -1)}>↑</button><button type="button" aria-label={'Mover campanha ' + (index + 1) + ' para baixo'} disabled={index === (draft.items || []).length - 1} onClick={() => onMove(index, 1)}>↓</button><button type="button" onClick={() => onRemove(index)}>Excluir campanha</button></div>
      </div>
    })}
    <button className="text-button" type="button" onClick={onAdd}>+ adicionar campanha</button>
  </div>
}
