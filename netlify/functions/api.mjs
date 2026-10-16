import serverless from 'serverless-http'
import { lambdaEvent, webResponse } from '../lib/http.mjs'

// This must precede the dynamic import: the classic server also supports npm start.
process.env.GALEO_SERVERLESS = 'true'
let runtimePromise
const runtime = () => (runtimePromise ??= import('../../server/index.js').then(module => ({
  ...module,
  handle: serverless(module.app)
})).catch(error => {
  runtimePromise = undefined
  throw error
}))

export default async function apiRequest(request, context) {
  try {
    const api = await runtime()
    return await api.withRequestTasks(async () => {
      try {
        await api.initializeRuntime()
        const result = await api.handle(await lambdaEvent(request, context), { callbackWaitsForEmptyEventLoop: false })
        return webResponse(result)
      } finally {
        await api.drainBackgroundTasks()
      }
    })
  } catch (error) {
    // Connection errors can include credentials. Log only a non-sensitive category.
    console.error('GALEO API indisponível:', typeof error?.code === 'string' ? error.code : 'RUNTIME_ERROR')
    return Response.json({ success: false, error: 'A loja está temporariamente indisponível. Tente novamente em instantes.' }, {
      status: 503, headers: { 'Cache-Control': 'no-store' }
    })
  }
}
