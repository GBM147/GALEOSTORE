import { before, after, test } from 'node:test'
import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'
import express from 'express'
import mysql from 'mysql2/promise'
import { createNewsletter, registerNewsletter } from '../server/newsletter.js'
import { createDataProtection } from '../server/data-protection.js'

// Only independently generated databases on the disposable loopback MySQL
// service are touched. The production application/provider are never loaded.
if (!['127.0.0.1', 'localhost', '::1'].includes(process.env.DB_HOST) || process.env.DB_PORT !== '3307' || process.env.DB_NAME !== 'galeo_store_test') {
  throw new Error('Newsletter tests require loopback MySQL:3307 and DB_NAME=galeo_store_test; production is refused.')
}
const namePattern = /^galeo_store_test_newsletter_[a-f0-9]{12}_\d+$/
const prefix = 'galeo_store_test_newsletter_' + randomBytes(6).toString('hex')
const connectionConfig = { host: process.env.DB_HOST, port: 3307, user: process.env.DB_USER, password: process.env.DB_PASSWORD }
let admin, sequence = 0
const outstanding = new Set()
before(async () => { admin = await mysql.createConnection(connectionConfig) })
after(async () => {
  for (const name of outstanding) {
    assert.match(name, namePattern)
    await admin.query('DROP DATABASE `' + name + '`')
  }
  await admin?.end()
})

async function fixture(run) {
  const database = prefix + '_' + (++sequence)
  assert.match(database, namePattern)
  await admin.query('CREATE DATABASE `' + database + '`')
  outstanding.add(database)
  const db = mysql.createPool({ ...connectionConfig, database, connectionLimit: 5 })
  const deliveries = []
  let configured = true, fail = false
  const emailService = {
    confirmationConfigured: () => configured,
    send: async payload => { if (fail) throw new Error('fake provider failure'); deliveries.push(payload); return { id: 'local-fake-delivery' } }
  }
  const make = protection => createNewsletter({ db, emailService, appUrl: 'https://store.example.invalid', protection })
  const newsletter = make()
  try {
    await newsletter.initialize()
    await run({ db, newsletter, deliveries, make, configure: value => { configured = value }, fail: value => { fail = value } })
  } finally {
    await db.end()
    assert.match(database, namePattern)
    await admin.query('DROP DATABASE `' + database + '`')
    outstanding.delete(database)
  }
}

const email = 'insider@example.invalid'
const tokens = delivery => {
  const confirmation = /https:\/\/[^\s]+#confirm=([a-f0-9]{64})/.exec(delivery.text)?.[1]
  const unsubscribe = /https:\/\/[^\s]+#unsubscribe=([a-f0-9]{64})/.exec(delivery.text)?.[1]
  assert.ok(confirmation && unsubscribe, 'links use full random tokens in URL fragments')
  return { confirmation, unsubscribe }
}

test('subscription is pending until a one-time token is explicitly confirmed; cancel link remains usable', async () => fixture(async ({ db, newsletter, deliveries }) => {
  assert.deepEqual(await newsletter.subscribe(' INSIDER@example.invalid '), { accepted: true })
  const token = tokens(deliveries[0])
  const [[row]] = await db.execute('SELECT * FROM newsletter_subscriptions')
  assert.equal(row.status, 'pending')
  assert.notEqual(row.token_hash, token.confirmation)
  assert.notEqual(row.unsubscribe_hash, token.unsubscribe)
  assert.ok(!JSON.stringify(row).includes(token.confirmation), 'plaintext token is not stored')
  assert.deepEqual(await newsletter.confirm(token.confirmation), { status: 'confirmed' })
  await assert.rejects(newsletter.confirm(token.confirmation), error => error.code === 'NEWSLETTER_LINK_INVALID')
  assert.deepEqual(await newsletter.unsubscribe(token.unsubscribe), { status: 'unsubscribed' })
  const [[cancelled]] = await db.execute('SELECT status,token_hash FROM newsletter_subscriptions')
  assert.equal(cancelled.status, 'unsubscribed')
  assert.equal(cancelled.token_hash, null)
}))

test('unconfigured sender, invalid address and failed provider never create a successful subscription', async () => fixture(async ({ db, newsletter, configure, fail }) => {
  configure(false)
  await assert.rejects(newsletter.subscribe(email), error => error.status === 503)
  await assert.rejects(newsletter.subscribe('false@localhost'), error => error.status === 400)
  configure(true)
  fail(true)
  await assert.rejects(newsletter.subscribe(email), error => error.code === 'NEWSLETTER_EMAIL_UNAVAILABLE')
  const [[count]] = await db.execute('SELECT COUNT(*) AS total FROM newsletter_subscriptions')
  assert.equal(count.total, 0)
}))

test('concurrent resends keep one row and one delivery; successful resend replaces the old token', async () => fixture(async ({ db, newsletter, deliveries }) => {
  await Promise.all([newsletter.subscribe(email), newsletter.subscribe(email)])
  assert.equal(deliveries.length, 1)
  const previous = tokens(deliveries[0])
  await db.execute('UPDATE newsletter_subscriptions SET sent_at=DATE_SUB(UTC_TIMESTAMP(),INTERVAL 61 SECOND)')
  await newsletter.subscribe(email)
  assert.equal(deliveries.length, 2)
  await assert.rejects(newsletter.confirm(previous.confirmation), error => error.code === 'NEWSLETTER_LINK_INVALID')
  assert.deepEqual(await newsletter.confirm(tokens(deliveries[1]).confirmation), { status: 'confirmed' })
  await newsletter.subscribe(email)
  assert.equal(deliveries.length, 2, 'already confirmed addresses do not receive unsolicited resends')
  const [[count]] = await db.execute('SELECT COUNT(*) AS total FROM newsletter_subscriptions')
  assert.equal(count.total, 1)
}))

test('expired or cancelled confirmation cannot activate subscription; confirmation does not depend on sender availability', async () => fixture(async ({ db, newsletter, deliveries, configure }) => {
  await newsletter.subscribe(email)
  const token = tokens(deliveries[0])
  await db.execute('UPDATE newsletter_subscriptions SET token_expires_at=DATE_SUB(UTC_TIMESTAMP(),INTERVAL 1 SECOND)')
  await assert.rejects(newsletter.confirm(token.confirmation), error => error.code === 'NEWSLETTER_LINK_INVALID')
  await newsletter.unsubscribe(token.unsubscribe)
  await assert.rejects(newsletter.confirm(token.confirmation), error => error.code === 'NEWSLETTER_LINK_INVALID')
  await newsletter.subscribe(email)
  configure(false)
  assert.deepEqual(await newsletter.confirm(tokens(deliveries[1]).confirmation), { status: 'confirmed' })
}))

test('protected subscriptions use HMAC lookup and authenticated encryption without plaintext email', async () => fixture(async ({ db, make, deliveries }) => {
  const protection = createDataProtection({ key: randomBytes(32).toString('base64') })
  const newsletter = make(protection)
  await newsletter.initialize()
  await newsletter.subscribe(email)
  const [[row]] = await db.execute('SELECT * FROM newsletter_subscriptions')
  assert.equal(row.email, '')
  assert.equal(row.email_lookup, protection.emailLookup(email, 'newsletter_subscriptions.email'))
  assert.ok(row.private_data)
  assert.ok(!JSON.stringify(row).includes(email))
  await newsletter.initialize()
  assert.deepEqual(await newsletter.confirm(tokens(deliveries[0]).confirmation), { status: 'confirmed' })
  await assert.rejects(make().initialize(), error => error.code === 'NEWSLETTER_PRIVACY_DOWNGRADE')
  await assert.rejects(make(createDataProtection({ key: randomBytes(32).toString('base64') })).initialize(), error => error.code === 'DATA_DECRYPTION_FAILED')
}))

test('plaintext subscriptions migrate to the same configured key and all protected rows validate before writes', async () => fixture(async ({ db, newsletter, make }) => {
  await newsletter.subscribe(email)
  const protection = createDataProtection({ key: randomBytes(32).toString('base64') })
  await make(protection).initialize()
  const [[row]] = await db.execute('SELECT * FROM newsletter_subscriptions')
  assert.equal(row.email, '')
  assert.equal(row.email_lookup, protection.emailLookup(email, 'newsletter_subscriptions.email'))
  assert.equal(protection.decryptJSON(row.private_data, { table: 'newsletter_subscriptions', field: 'private_data', rowId: String(row.id) }).email, email)
}))

test('public routes require JSON, expose only fixed errors and apply subscription rate limits', async () => fixture(async ({ newsletter, configure }) => {
  const app = express()
  app.use(express.json())
  registerNewsletter(app, { newsletter })
  const server = await new Promise(resolve => { const running = app.listen(0, '127.0.0.1', () => resolve(running)) })
  const base = 'http://127.0.0.1:' + server.address().port
  try {
    const wrongType = await fetch(base + '/api/store/newsletter/subscribe', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: 'email=' + email })
    assert.equal(wrongType.status, 415)
    configure(false)
    const unavailable = await fetch(base + '/api/store/newsletter/subscribe', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email }) })
    assert.equal(unavailable.status, 503)
    assert.equal((await unavailable.json()).code, 'NEWSLETTER_EMAIL_UNAVAILABLE')
    const invalid = await fetch(base + '/api/store/newsletter/confirm', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token: 'wrong' }) })
    assert.equal(invalid.status, 400)
    let last
    for (let attempt = 0; attempt < 10; attempt++) last = await fetch(base + '/api/store/newsletter/subscribe', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email }) })
    assert.equal(last.status, 429)
    assert.ok(last.headers.get('Retry-After'))
  } finally {
    server.closeAllConnections()
    await new Promise(resolve => server.close(resolve))
  }
}))
