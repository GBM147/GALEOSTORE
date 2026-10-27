// Share only requests that are currently in flight (including React StrictMode).
// Published content is fetched fresh on a new visit; drafts and owner responses
// are never persisted in a browser cache or shared with another context.
const pending = new Map()

export function loadStorefrontJson(path, { credentials = 'same-origin' } = {}) {
  const key = credentials + ':' + path
  if (pending.has(key)) return pending.get(key)
  const request = fetch(path, { cache:'no-store', credentials, headers:{ Accept:'application/json' } })
    .then(async response => {
      if (!response.ok) {
        const error = new Error('Não foi possível carregar os dados da loja.')
        error.status = response.status
        throw error
      }
      return response.json()
    })
    .finally(() => { if (pending.get(key) === request) pending.delete(key) })
  pending.set(key, request)
  return request
}
