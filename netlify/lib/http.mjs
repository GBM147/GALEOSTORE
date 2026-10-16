import { isIP } from 'node:net'

const prefix = '/.netlify/functions/api'

// Rewrites and direct function URLs must reach the same Express routes.
export function apiPath(pathname) {
  if (pathname === prefix) return '/api'
  return pathname.startsWith(prefix + '/') ? pathname.slice(prefix.length) : pathname
}

export async function lambdaEvent(request, context) {
  const url = new URL(request.url)
  const headers = Object.fromEntries(request.headers)
  // Netlify's context supplies the peer address; never use a caller's XFF value.
  const ip = isIP(context.ip || '') ? context.ip : '127.0.0.1'
  headers['x-forwarded-for'] = ip
  headers['x-forwarded-proto'] = url.protocol.slice(0, -1)
  headers.host = url.host
  const query = {}
  for (const [key, value] of url.searchParams) (query[key] ??= []).push(value)
  const body = ['GET', 'HEAD'].includes(request.method) ? '' : Buffer.from(await request.arrayBuffer()).toString('base64')
  return {
    httpMethod: request.method,
    path: apiPath(url.pathname),
    headers,
    multiValueQueryStringParameters: query,
    body,
    isBase64Encoded: true,
    requestContext: { requestId: context.requestId, identity: { sourceIp: ip } }
  }
}

export function webResponse(result) {
  const headers = new Headers(result.headers)
  // Set-Cookie must stay separate: joined cookies break session renewal/logout.
  for (const [name, values] of Object.entries(result.multiValueHeaders || {})) {
    headers.delete(name)
    for (const value of values) headers.append(name, value)
  }
  headers.set('Cache-Control', 'no-store')
  const empty = [204, 205, 304].includes(result.statusCode)
  const body = empty ? null : result.isBase64Encoded ? Buffer.from(result.body || '', 'base64') : result.body
  return new Response(body, { status: result.statusCode, headers })
}
