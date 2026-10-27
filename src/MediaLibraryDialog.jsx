import { useLayoutEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import './MediaLibraryDialog.css'

// Keep the library grid and document height unchanged while working on a file.
// A native dialog also gives keyboard users a contained focus and Escape close.
export default function MediaLibraryDialog({ title, busy, onClose, children }) {
  const dialog = useRef(null)
  useLayoutEffect(() => {
    const opener = document.activeElement
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    dialog.current?.showModal()
    return () => {
      if (dialog.current?.open) dialog.current.close()
      document.body.style.overflow = previousOverflow
      if (opener?.isConnected && !opener.disabled) opener.focus({ preventScroll:true })
    }
  }, [])
  return createPortal(<dialog ref={dialog} className="media-library-dialog" aria-label={title} data-lenis-prevent=""
    onCancel={event => { event.preventDefault(); if (!busy) onClose() }}>
    {children}
  </dialog>, document.body)
}
