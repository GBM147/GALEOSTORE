let csrfToken = ''

export const getAdminCsrfToken = () => csrfToken

export function clearAdminCsrfToken() {
  csrfToken = ''
}

export async function adminApi(path, options = {}) {
  const headers = new Headers(options.headers || {})
  if (options.body && typeof options.body !== 'string') {
    headers.set('Content-Type', 'application/json')
    options = { ...options, body: JSON.stringify(options.body) }
  }

  const method = String(options.method || 'GET').toUpperCase()
  if (!['GET', 'HEAD', 'OPTIONS'].includes(method) && path !== '/api/auth/login' && csrfToken) {
    headers.set('X-CSRF-Token', csrfToken)
  }

  const response = await fetch(path, {
    ...options,
    headers,
    credentials: 'include'
  })

  const raw = await response.text()
  let data = null
  try { data = raw ? JSON.parse(raw) : null } catch {}

  if (data?.csrfToken) csrfToken = data.csrfToken
  if (!response.ok) {
    const error = new Error(data?.error || 'Erro na comunicação com o servidor.')
    error.status = response.status
    error.code = data?.code
    error.data = data
    if (path !== '/api/auth/login' && (error.status === 401 || error.code === 'ADMIN_OWNER_REQUIRED')) {
      window.dispatchEvent(new Event('galeo-admin-auth-required'))
    }
    throw error
  }
  return data
}
