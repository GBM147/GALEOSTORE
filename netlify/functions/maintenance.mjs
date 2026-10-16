// Netlify invokes scheduled functions privately, in production only.
// Schedule: 06:10 UTC / 03:10 America/Sao_Paulo, configured in netlify.toml.
process.env.GALEO_SERVERLESS = 'true'
let runtimePromise
const runtime = () => (runtimePromise ??= import('../../server/index.js').catch(error => {
  runtimePromise = undefined
  throw error
}))

export default async function maintenance() {
  const api = await runtime()
  await api.withRequestTasks(async () => {
    try {
      await api.initializeRuntime()
      await api.runMaintenance()
    } finally {
      await api.drainBackgroundTasks()
    }
  })
  return new Response(null, { status: 204 })
}
