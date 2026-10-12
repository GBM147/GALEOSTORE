import { appendFile } from 'node:fs/promises'
import { v2 as cloudinary } from 'cloudinary'

if (process.env.NODE_ENV !== 'test' || process.env.DB_HOST !== '127.0.0.1' || process.env.DB_PORT !== '3307' ||
    !/^galeo_store_test_home_[a-f0-9]{12}$/.test(process.env.DB_NAME || '') || !process.env.GALEO_TEST_MEDIA_NETWORK_GUARD) {
  throw new Error('The Home workflow network guard requires a generated disposable local MySQL fixture.')
}
async function refused(operation) {
  await appendFile(process.env.GALEO_TEST_MEDIA_NETWORK_GUARD, JSON.stringify({ operation }) + '\n', { mode: 0o600 })
  throw new Error('External providers are disabled for the disposable local Home fixture.')
}
const originalFetch = globalThis.fetch
globalThis.fetch = async (input, options) => {
  const address = new URL(typeof input === 'string' || input instanceof URL ? input : input.url)
  if (!['127.0.0.1', 'localhost', '[::1]'].includes(address.hostname)) return refused('external-fetch')
  return originalFetch(input, options)
}
cloudinary.uploader.explicit = () => refused('cloudinary-explicit')
cloudinary.uploader.upload_stream = () => { void refused('cloudinary-upload').catch(() => {}); throw new Error('Cloudinary uploads are disabled for local tests.') }
cloudinary.uploader.destroy = () => refused('cloudinary-destroy')
