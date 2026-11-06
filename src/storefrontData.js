// Share only requests that are currently in flight (including React StrictMode).
// Published content is fetched fresh on a new visit; drafts and owner responses
// are never persisted in a browser cache or shared with another context.
const pending = new Map()
// Requests started before React renders, handed to the first matching load.
const prefetched = new Map()
const keyOf = (path, credentials) => credentials + ':' + path

function request(path, credentials) {
  return fetch(path, { cache:'no-store', credentials, headers:{ Accept:'application/json' } })
    .then(async response => {
      if (!response.ok) {
        const error = new Error('Não foi possível carregar os dados da loja.')
        error.status = response.status
        throw error
      }
      return response.json()
    })
}

export function loadStorefrontJson(path, { credentials = 'same-origin' } = {}) {
  const key = keyOf(path, credentials)
  if (pending.has(key)) return pending.get(key)
  const early = prefetched.get(key)
  prefetched.delete(key)
  const result = (early || request(path, credentials))
    .finally(() => { if (pending.get(key) === result) pending.delete(key) })
  pending.set(key, result)
  return result
}

// Starts a public request while the app code is still rendering. An unused
// prefetch is dropped after a short time so a later visit fetches fresh data.
export function prefetchStorefrontJson(path, { credentials = 'same-origin' } = {}) {
  const key = keyOf(path, credentials)
  if (pending.has(key) || prefetched.has(key)) return
  const early = request(path, credentials)
  early.catch(() => {})
  prefetched.set(key, early)
  setTimeout(() => { if (prefetched.get(key) === early) prefetched.delete(key) }, 10000)
}
