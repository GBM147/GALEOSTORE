import { useEffect } from 'react'

const site = 'Galeo Store'

// Tab and search titles during client-side navigation. Product pages also get
// their preview tags from the server, for link previews that run no JavaScript.
export function pageTitle(title) {
  const text = typeof title === 'string' ? title.replace(/\s+/g, ' ').trim() : ''
  return text ? text + ' | ' + site : site
}

export function usePageMeta(title, description) {
  useEffect(() => {
    const meta = document.querySelector('meta[name="description"]')
    const previous = { title: document.title, description: meta?.getAttribute('content') }
    document.title = pageTitle(title)
    const text = typeof description === 'string' ? description.replace(/\s+/g, ' ').trim().slice(0, 160) : ''
    if (meta && text) meta.setAttribute('content', text)
    return () => {
      document.title = previous.title
      if (meta && previous.description != null) meta.setAttribute('content', previous.description)
    }
  }, [title, description])
}
