import { useState } from 'react'
import { cloudinaryImageUrl, cloudinarySrcSet } from './cloudinaryImage'

// Requests a resized Cloudinary version and falls back to the original photo
// once if that version fails (for example, when transformations are unavailable).
export function ResponsiveImage({ ref, src, widths, sizes, fallbackWidth, onError, ...props }) {
  const [failedSource, setFailedSource] = useState(null)
  const resized = cloudinaryImageUrl(src, fallbackWidth || widths?.at(-1) || 1200)
  const original = failedSource === src || resized === src
  return <img ref={ref} {...props} src={original ? src : resized}
    srcSet={original ? undefined : cloudinarySrcSet(src, widths)} sizes={original ? undefined : sizes}
    onError={event => { if (!original) setFailedSource(src); else onError?.(event) }} />
}

// <picture> with an optional phone photo, both resized, with the same fallback.
export function ResponsivePicture({ src, mobileSrc, widths, mobileWidths, sizes = '100vw', fallbackWidth, onError, ...props }) {
  const [failedKey, setFailedKey] = useState(null)
  const key = src + '|' + (mobileSrc || '')
  const original = failedKey === key
  return <picture>
    {mobileSrc && <source media="(max-width: 700px)" srcSet={original ? mobileSrc : cloudinarySrcSet(mobileSrc, mobileWidths) || mobileSrc} sizes={original ? undefined : sizes} />}
    <img {...props} src={original ? src : cloudinaryImageUrl(src, fallbackWidth || widths?.at(-1) || 1600)}
      srcSet={original ? undefined : cloudinarySrcSet(src, widths)} sizes={original ? undefined : sizes}
      onError={event => { if (!original && (cloudinaryImageUrl(src, 1) !== src || (mobileSrc && cloudinaryImageUrl(mobileSrc, 1) !== mobileSrc))) setFailedKey(key); else onError?.(event) }} />
  </picture>
}
