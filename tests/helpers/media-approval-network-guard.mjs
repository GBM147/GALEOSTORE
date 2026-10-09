import { appendFile } from 'node:fs/promises'
import { v2 as cloudinary } from 'cloudinary'

if (process.env.NODE_ENV !== 'test' || process.env.DB_HOST !== '127.0.0.1' ||
    process.env.DB_PORT !== '3307' || process.env.DB_NAME !== 'galeo_store_test' ||
    !process.env.GALEO_TEST_MEDIA_NETWORK_GUARD) {
  throw new Error('The media approval network guard only runs against the isolated local test service.')
}

async function refused(operation) {
  await appendFile(process.env.GALEO_TEST_MEDIA_NETWORK_GUARD, JSON.stringify({ operation }) + '\n', { mode: 0o600 })
  throw new Error('External provider access is disabled for the local media approval test.')
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
