const states = new Set(['AC','AL','AP','AM','BA','CE','DF','ES','GO','MA','MT','MS','MG','PA','PB','PR','PE','PI','RJ','RN','RS','RO','RR','SC','SP','SE','TO'])

export class PostalCodeError extends Error {
  constructor(code, status, message) { super(message); this.code=code; this.status=status }
}
const unavailable = () => new PostalCodeError('POSTAL_CODE_UNAVAILABLE',503,'Não foi possível consultar o CEP agora. Você pode preencher o endereço manualmente.')
const missing = () => new PostalCodeError('POSTAL_CODE_NOT_FOUND',404,'CEP não encontrado. Confira os números ou preencha o endereço manualmente.')

export function normalizePostalCode(value) {
  if (typeof value!=='string' || !/^(?:\d{8}|\d{5}-\d{3})$/.test(value)) throw new PostalCodeError('POSTAL_CODE_INVALID',400,'Informe um CEP com 8 números.')
  return value.replace('-','')
}

function addressFrom(data, requested, provider) {
  if (!data || typeof data!=='object' || Array.isArray(data)) throw unavailable()
  if (provider==='viacep' && (data.erro===true || data.erro==='true')) throw missing()
  const value = provider==='viacep'
    ? { postal_code:data.cep,street:data.logradouro,neighborhood:data.bairro,city:data.localidade,state:data.uf }
    : { postal_code:data.cep,street:data.street,neighborhood:data.neighborhood,city:data.city,state:data.state }
  let code
  try { code=normalizePostalCode(value.postal_code) } catch { throw unavailable() }
  if (code!==requested || typeof value.city!=='string' || !value.city.trim() || typeof value.state!=='string' || !states.has(value.state.toUpperCase())) throw unavailable()
  const text = (value,limit) => {
    if (value==null) return ''
    if (typeof value!=='string' || value.length>limit || /[\x00-\x1f\x7f]/.test(value)) throw unavailable()
    return value.trim()
  }
  return Object.freeze({postal_code:code,street:text(value.street,300),neighborhood:text(value.neighborhood,160),city:text(value.city,160),state:value.state.toUpperCase()})
}

// Only a postcode is sent to these fixed HTTPS hosts; never name, telephone,
// street number or customer details. Cache is bounded and remains in memory.
export function createPostalCodeLookup({fetchImpl=globalThis.fetch,timeoutMs=3500,cacheTtlMs=3600000,maxEntries=256,now=Date.now}={}) {
  const cache=new Map(),pending=new Map()
  const providers=[
    {name:'viacep',url:code=>'https://viacep.com.br/ws/'+code+'/json/'},
    {name:'brasilapi',url:code=>'https://brasilapi.com.br/api/cep/v1/'+code}
  ]
  async function query(provider,code) {
    const controller=new AbortController()
    const timer=setTimeout(()=>controller.abort(),timeoutMs)
    try {
      const response=await fetchImpl(provider.url(code),{headers:{Accept:'application/json'},signal:controller.signal,redirect:'error'})
      if (response.status===404) throw missing()
      if (!response.ok) throw unavailable()
      return addressFrom(await response.json(),code,provider.name)
    } catch (error) {
      if (error instanceof PostalCodeError) throw error
      throw unavailable()
    } finally {clearTimeout(timer)}
  }
  async function load(code) {
    for (const provider of providers) {
      try {
        const address=await query(provider,code)
        if (maxEntries>0) {
          if (cache.size>=maxEntries) cache.delete(cache.keys().next().value)
          cache.set(code,{address,expires:now()+cacheTtlMs})
        }
        return address
      } catch (error) {if (error.status===404) throw error}
    }
    throw unavailable()
  }
  return async value => {
    const code=normalizePostalCode(value)
    const stored=cache.get(code)
    if (stored && stored.expires>now()) return {...stored.address}
    if (stored) cache.delete(code)
    if (!pending.has(code)) pending.set(code,load(code).finally(()=>pending.delete(code)))
    return {...await pending.get(code)}
  }
}

export function registerPostalCodeLookup(app,{lookup=createPostalCodeLookup(),limiter=(_req,_res,next)=>next()}={}) {
  app.get('/api/store/postal-codes/:postalCode',(_req,res,next)=>{res.set('Cache-Control','no-store');next()},limiter,async(req,res)=>{
    try {res.json(await lookup(req.params.postalCode))}
    catch(error) {
      const safe=error instanceof PostalCodeError ? error : unavailable()
      res.status(safe.status).json({error:safe.message,code:safe.code})
    }
  })
}
