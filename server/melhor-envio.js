import { createHash, createHmac, hkdfSync, randomBytes, timingSafeEqual } from 'node:crypto'
import { createDataProtection } from './data-protection.js'
import { inventorySelection, ProductVariantError } from './product-variants.js'

const PROVIDER = 'MELHOR_ENVIO'
const STATE_TTL = 10 * 60 * 1000
const QUOTE_TTL = 15 * 60 * 1000
const TOKEN_CONTEXT = { table:'shipping_integrations', field:'encrypted_tokens', rowId:PROVIDER }
const BASES = Object.freeze({ production:'https://melhorenvio.com.br', sandbox:'https://sandbox.melhorenvio.com.br' })

export class MelhorEnvioError extends Error {
  constructor(message, status = 400, code = 'SHIPPING_INVALID') {
    super(message)
    this.name = 'MelhorEnvioError'
    this.status = status
    this.code = code
  }
}
const fail = (message, status, code) => { throw new MelhorEnvioError(message, status, code) }
const digest = value => createHash('sha256').update(value).digest('hex')
const numeric = value => (typeof value === 'number' || typeof value === 'string' && value.trim() !== '') && Number.isFinite(Number(value))
const integer = value => numeric(value) && Number.isSafeInteger(Number(value)) && Number(value) > 0 ? Number(value) : 0
const parseJson = value => typeof value === 'string' ? JSON.parse(value) : value

export async function ensureMelhorEnvioSchema({ query, ensureColumn }) {
  await query(`CREATE TABLE IF NOT EXISTS shipping_integrations (
    provider VARCHAR(40) CHARACTER SET ascii COLLATE ascii_bin PRIMARY KEY,
    encrypted_tokens JSON NULL,
    expires_at BIGINT NULL,
    state_hash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NULL,
    state_expires_at BIGINT NULL,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`)
  await ensureColumn('products', 'shipping_weight', 'DECIMAL(10,3) NULL')
  for (const field of ['shipping_width', 'shipping_height', 'shipping_length']) await ensureColumn('products', field, 'DECIMAL(10,2) NULL')
  await ensureColumn('store_orders', 'shipping_details', 'JSON NULL')
}

function postalCode(value) {
  if (typeof value !== 'string' || !/^\d{5}-?\d{3}$/.test(value.trim())) fail('Informe um CEP válido com oito números.')
  return value.trim().replace('-', '')
}

function saveSession(session) {
  return typeof session?.save === 'function' ? new Promise((resolve,reject) => session.save(error => error ? reject(error) : resolve())) : Promise.resolve()
}

/** OAuth tokens never leave this service. Queries only run after explicit migration. */
export function createMelhorEnvio({ db, query, sessionSecret, protection, env = process.env, fetchImpl = globalThis.fetch, now = Date.now }) {
  const clientId = String(env.MELHOR_ENVIO_CLIENT_ID || '').trim()
  const clientSecret = String(env.MELHOR_ENVIO_CLIENT_SECRET || '').trim()
  const environment = String(env.MELHOR_ENVIO_ENVIRONMENT || 'production').trim()
  const base = BASES[environment]
  const redirectUri = String(env.MELHOR_ENVIO_REDIRECT_URI || (String(env.APP_URL || 'https://galeo-store.netlify.app').replace(/\/$/,'') + '/api/integrations/melhor-envio/callback')).trim()
  const origin = String(env.MELHOR_ENVIO_ORIGIN_POSTAL_CODE || '').trim().replace('-', '')
  const contact = String(env.MELHOR_ENVIO_CONTACT_EMAIL || 'storegaleo@gmail.com').trim()
  let validRedirect = false
  try { const url = new URL(redirectUri); validRedirect = !url.username && !url.password && !url.hash && !url.search && (url.protocol === 'https:' || env.NODE_ENV === 'test' && url.protocol === 'http:' && ['localhost','127.0.0.1'].includes(url.hostname)) } catch {}
  const pending = [!clientId && 'MELHOR_ENVIO_CLIENT_ID', !clientSecret && 'MELHOR_ENVIO_CLIENT_SECRET', !validRedirect && 'MELHOR_ENVIO_REDIRECT_URI', !/^\d{8}$/.test(origin) && 'MELHOR_ENVIO_ORIGIN_POSTAL_CODE', !base && 'MELHOR_ENVIO_ENVIRONMENT', !/^\S+@\S+\.\S+$/.test(contact) && 'MELHOR_ENVIO_CONTACT_EMAIL'].filter(Boolean)
  const configured = pending.length === 0
  const required = () => Boolean(clientId || clientSecret)
  const rootKey = Buffer.from(hkdfSync('sha256', String(sessionSecret || ''), Buffer.alloc(0), 'GALEO/melhor-envio/v1', 32))
  const tokenProtection = protection || createDataProtection({ key:rootKey.toString('base64'), keyId:'shipping-session-v1' })
  const signingKey = Buffer.from(hkdfSync('sha256', rootKey, Buffer.alloc(0), 'GALEO/shipping-quote/v1', 32))
  const appFingerprint = digest(JSON.stringify([environment, clientId, redirectUri]))
  const signature = value => createHmac('sha256', signingKey).update(value).digest('base64url')
  const configuredOrFail = () => { if (!configured) fail('O frete ainda precisa ser configurado pela loja.', 503, 'SHIPPING_NOT_CONFIGURED') }

  function decodeTokens(row) {
    if (!row?.encrypted_tokens) return null
    try {
      const tokens = tokenProtection.decryptJSON(parseJson(row.encrypted_tokens), TOKEN_CONTEXT)
      if (tokens.application !== appFingerprint || tokens.environment !== environment) return null
      if (typeof tokens.access_token !== 'string' || !tokens.access_token || typeof tokens.refresh_token !== 'string' || !tokens.refresh_token) return null
      return tokens
    } catch { fail('A conexão de frete precisa ser autorizada novamente.', 503, 'SHIPPING_RECONNECT_REQUIRED') }
  }

  async function status() {
    const [row] = await query('SELECT encrypted_tokens,expires_at FROM shipping_integrations WHERE provider=?', [PROVIDER])
    let connected = false, connectionError = null
    try { connected = Boolean(decodeTokens(row)) } catch { connectionError = 'Autorize novamente a conexão de frete.' }
    return { provider:PROVIDER, configured:required(), configuration_complete:configured, connected, available:configured && connected, required:required(), environment, origin_postal_code:origin, pending_configuration:[...pending], configuration_error:configured ? null : 'A configuração do frete ainda está incompleta.', connection_error:connectionError }
  }

  async function startAuthorization(req) {
    configuredOrFail()
    if (!req.session) fail('Entre novamente no painel para conectar o frete.', 401, 'SHIPPING_SESSION_REQUIRED')
    const state = randomBytes(32).toString('base64url')
    const stateHash = digest(state)
    req.session.melhorEnvioOAuth = { hash:stateHash, expires_at:now() + STATE_TTL }
    await query('INSERT INTO shipping_integrations(provider,state_hash,state_expires_at) VALUES(?,?,?) ON DUPLICATE KEY UPDATE state_hash=VALUES(state_hash),state_expires_at=VALUES(state_expires_at)', [PROVIDER, stateHash, req.session.melhorEnvioOAuth.expires_at])
    await saveSession(req.session)
    const url = new URL(base + '/oauth/authorize')
    url.search = new URLSearchParams({ client_id:clientId, redirect_uri:redirectUri, response_type:'code', state, scope:'shipping-calculate' }).toString()
    return { authorization_url:url.toString() }
  }

  async function request(path, { body, accessToken } = {}) {
    let response, data
    try {
      response = await fetchImpl(base + path, {
        method:'POST', redirect:'error', signal:AbortSignal.timeout(15000),
        headers:{ Accept:'application/json', 'Content-Type':'application/json', 'User-Agent':'GALEO (' + contact + ')', ...(accessToken ? { Authorization:'Bearer ' + accessToken } : {}) },
        body:JSON.stringify(body)
      })
      data = await response.json()
    } catch { fail('Não foi possível consultar o serviço de frete. Tente novamente em instantes.', 503, 'SHIPPING_PROVIDER_UNAVAILABLE') }
    if (!response.ok) {
      // Never propagate a provider body: OAuth responses can contain credentials.
      const error = new MelhorEnvioError('Não foi possível consultar o serviço de frete. Tente novamente em instantes.', 503, 'SHIPPING_PROVIDER_UNAVAILABLE')
      Object.defineProperty(error, 'providerStatus', { value:response.status })
      throw error
    }
    return data
  }

  function validatedTokenResponse(data) {
    const expiresIn = Number(data?.expires_in)
    if (typeof data?.access_token !== 'string' || !data.access_token || data.access_token.length > 32768 || typeof data?.refresh_token !== 'string' || !data.refresh_token || data.refresh_token.length > 32768 || !Number.isFinite(expiresIn) || expiresIn < 60 || expiresIn > 366 * 86400 || data.token_type && String(data.token_type).toLowerCase() !== 'bearer') fail('O serviço de frete não confirmou a autorização.', 503, 'SHIPPING_AUTH_FAILED')
    return { tokens:{ access_token:data.access_token, refresh_token:data.refresh_token, application:appFingerprint, environment }, expires_at:now() + Math.floor(expiresIn * 1000) }
  }

  async function persistTokens(conn, result) {
    await conn.execute('UPDATE shipping_integrations SET encrypted_tokens=?,expires_at=? WHERE provider=?', [JSON.stringify(tokenProtection.encryptJSON(result.tokens, TOKEN_CONTEXT)), result.expires_at, PROVIDER])
  }

  async function completeAuthorization(req) {
    configuredOrFail()
    const state = req.query?.state
    const pendingState = req.session?.melhorEnvioOAuth
    delete req.session?.melhorEnvioOAuth
    await saveSession(req.session)
    if (typeof state !== 'string' || state.length > 128 || !pendingState || pendingState.expires_at <= now() || digest(state) !== pendingState.hash) fail('A autorização expirou. Volte ao painel e conecte novamente.', 400, 'SHIPPING_OAUTH_STATE_INVALID')
    const consumed = await query('UPDATE shipping_integrations SET state_hash=NULL,state_expires_at=NULL WHERE provider=? AND state_hash=? AND state_expires_at>?', [PROVIDER, pendingState.hash, now()])
    if (consumed.affectedRows !== 1) fail('A autorização expirou. Volte ao painel e conecte novamente.', 400, 'SHIPPING_OAUTH_STATE_INVALID')
    if (req.query?.error || typeof req.query?.code !== 'string' || !req.query.code || req.query.code.length > 4096) fail('A autorização do frete não foi concluída. Conecte novamente pelo painel.', 400, 'SHIPPING_AUTH_DENIED')
    const result = validatedTokenResponse(await request('/oauth/token', { body:{ grant_type:'authorization_code', client_id:clientId, client_secret:clientSecret, redirect_uri:redirectUri, code:req.query.code } }))
    await query('UPDATE shipping_integrations SET encrypted_tokens=?,expires_at=? WHERE provider=?', [JSON.stringify(tokenProtection.encryptJSON(result.tokens, TOKEN_CONTEXT)), result.expires_at, PROVIDER])
    return { connected:true }
  }

  async function accessToken({ forceFor } = {}) {
    configuredOrFail()
    const conn = await db.getConnection()
    try {
      await conn.beginTransaction()
      // Holding this row across refresh prevents rotating the same refresh token
      // simultaneously in different Netlify Function instances.
      const [[row]] = await conn.execute('SELECT encrypted_tokens,expires_at FROM shipping_integrations WHERE provider=? FOR UPDATE', [PROVIDER])
      const tokens = decodeTokens(row)
      if (!tokens) fail('Conecte a conta Melhor Envio no painel da loja.', 503, 'SHIPPING_NOT_CONNECTED')
      if (Number(row.expires_at) > now() + 5 * 60 * 1000 && (!forceFor || forceFor !== tokens.access_token)) {
        await conn.commit()
        return tokens.access_token
      }
      let result
      try { result = validatedTokenResponse(await request('/oauth/token', { body:{ grant_type:'refresh_token', client_id:clientId, client_secret:clientSecret, refresh_token:tokens.refresh_token } })) }
      catch (error) {
        if ([400,401,403].includes(error.providerStatus)) {
          await conn.execute('UPDATE shipping_integrations SET encrypted_tokens=NULL,expires_at=NULL WHERE provider=?', [PROVIDER])
          await conn.commit()
          fail('A conexão de frete expirou. Autorize novamente pelo painel.', 503, 'SHIPPING_RECONNECT_REQUIRED')
        }
        throw error
      }
      await persistTokens(conn, result)
      await conn.commit()
      return result.tokens.access_token
    } catch (error) {
      await conn.rollback().catch(() => {})
      throw error
    } finally { conn.release() }
  }

  function cartDescription(items, products) {
    if (!Array.isArray(items) || !items.length || items.length > 100) fail('Confira os produtos do carrinho antes de calcular o frete.')
    const byId = products instanceof Map ? products : new Map((products || []).map(product => [Number(product.id), product]))
    const seen = new Set()
    return items.map(item => {
      const productId = integer(item?.product_id)
      const quantity = integer(item?.quantity)
      const product = byId.get(productId)
      if (!product || !Number(product.active) || !quantity || quantity > 50) fail('Uma peça do carrinho não está disponível para entrega.', 409, 'SHIPPING_CART_CHANGED')
      let selection
      try { selection = inventorySelection(product, item.variant_id) }
      catch (error) {
        if (error instanceof ProductVariantError) fail(error.message, 409, 'SHIPPING_CART_CHANGED')
        throw error
      }
      const key = productId + ':' + (selection.variant_id || '')
      if (seen.has(key)) fail('Uma peça está repetida no carrinho.')
      seen.add(key)
      if (quantity > selection.stock) fail('Uma peça do carrinho está sem estoque suficiente.', 409, 'SHIPPING_CART_CHANGED')
      const cents = Math.round(Number(product.price) * 100)
      if (!numeric(product.price) || !Number.isSafeInteger(cents) || cents <= 0) fail('O preço de uma peça ainda não foi definido.', 409, 'SHIPPING_CART_CHANGED')
      const metricValues = ['weight','width','height','length'].map(field => product['shipping_' + field])
      const metrics = metricValues.map(Number)
      if (metricValues.some(value => !numeric(value)) || metrics.some(value => !Number.isFinite(value) || value <= 0 || value > 1000)) fail('A loja precisa informar o peso e as medidas de uma peça para calcular a entrega.', 409, 'SHIPPING_MEASUREMENTS_REQUIRED')
      return { product_id:productId, variant_id:selection.variant_id || null, quantity, cents, weight:metrics[0], width:metrics[1], height:metrics[2], length:metrics[3] }
    }).sort((a,b) => a.product_id - b.product_id || (a.variant_id || 0) - (b.variant_id || 0))
  }
  const cartDigest = rows => digest(JSON.stringify(rows))
  const signed = payload => { const body = Buffer.from(JSON.stringify(payload)).toString('base64url'); return body + '.' + signature(body) }

  async function calculateQuotes({ items, postal_code, products }) {
    configuredOrFail()
    const destination = postalCode(postal_code)
    const rows = cartDescription(items, products)
    const body = { from:{postal_code:origin}, to:{postal_code:destination}, products:rows.map(row => ({ id:String(row.product_id) + (row.variant_id ? '-V' + row.variant_id : ''), width:row.width, height:row.height, length:row.length, weight:row.weight, insurance_value:row.cents / 100, quantity:row.quantity })), options:{receipt:false,own_hand:false} }
    let token = await accessToken()
    let data
    try { data = await request('/api/v2/me/shipment/calculate', { body, accessToken:token }) }
    catch (error) {
      if (error.providerStatus !== 401) throw error
      token = await accessToken({ forceFor:token })
      data = await request('/api/v2/me/shipment/calculate', { body, accessToken:token })
    }
    if (!Array.isArray(data)) fail('O serviço de frete não retornou opções válidas.', 503, 'SHIPPING_PROVIDER_UNAVAILABLE')
    const expires = now() + QUOTE_TTL
    const cart = cartDigest(rows)
    const unique = new Set()
    const quotes = data.flatMap(service => {
      const rawPrice = service?.custom_price ?? service?.price
      const rawDelivery = service?.custom_delivery_time ?? service?.delivery_time
      if (!numeric(rawPrice) || !numeric(rawDelivery)) return []
      const price = Number(rawPrice)
      const delivery = Number(rawDelivery)
      const cents = Math.round(price * 100)
      const id = integer(service?.id)
      if (!id || unique.has(id) || service.error || !Number.isFinite(price) || price < 0 || !Number.isSafeInteger(cents) || cents > 100000000 || !Number.isSafeInteger(delivery) || delivery < 0 || delivery > 365 || typeof service.name !== 'string' || !service.name.trim() || service.name.length > 100 || typeof service.company?.name !== 'string' || !service.company.name.trim() || service.company.name.length > 100) return []
      unique.add(id)
      const quote = { id:String(id), name:service.name.trim(), company:service.company.name.trim(), price:cents / 100, delivery_days:delivery }
      return [{ ...quote, token:signed({ v:1, application:appFingerprint, origin, destination, cart, expires, quote }) }]
    }).sort((a,b) => a.price - b.price || a.delivery_days - b.delivery_days)
    if (!quotes.length) fail('Nenhuma transportadora está disponível para este CEP e estas peças.', 400, 'SHIPPING_NO_SERVICES')
    return { quotes, expires_at:new Date(expires).toISOString() }
  }

  function validateQuote({ token, items, postal_code, products }) {
    configuredOrFail()
    if (typeof token !== 'string' || token.length > 4096) fail('Calcule e selecione o frete antes de enviar o pedido.', 400, 'SHIPPING_QUOTE_REQUIRED')
    const parts = token.split('.')
    if (parts.length !== 2 || !parts.every(value => /^[\w-]+$/.test(value))) fail('Calcule o frete novamente para continuar.', 400, 'SHIPPING_QUOTE_INVALID')
    const expected = Buffer.from(signature(parts[0]))
    const actual = Buffer.from(parts[1])
    if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) fail('Calcule o frete novamente para continuar.', 400, 'SHIPPING_QUOTE_INVALID')
    let payload
    try { payload = JSON.parse(Buffer.from(parts[0], 'base64url').toString('utf8')) } catch { fail('Calcule o frete novamente para continuar.', 400, 'SHIPPING_QUOTE_INVALID') }
    if (payload.v !== 1 || payload.application !== appFingerprint || payload.origin !== origin || payload.destination !== postalCode(postal_code) || !Number.isSafeInteger(payload.expires) || payload.expires <= now() || payload.expires > now() + QUOTE_TTL || payload.cart !== cartDigest(cartDescription(items, products))) fail('O carrinho, CEP ou prazo da cotação mudou. Calcule o frete novamente.', 409, 'SHIPPING_QUOTE_EXPIRED')
    return { price:payload.quote.price, details:{provider:PROVIDER,environment,service_id:payload.quote.id,service_name:payload.quote.name,name:payload.quote.name,company:payload.quote.company,delivery_days:payload.quote.delivery_days,price:payload.quote.price,quoted_at:new Date(payload.expires - QUOTE_TTL).toISOString()} }
  }

  return Object.freeze({ status, required, startAuthorization, completeAuthorization, calculateQuotes, validateQuote })
}
