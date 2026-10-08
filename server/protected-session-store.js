import session from 'express-session'

const contextFor = (id) => ({ table: 'sessions', field: 'data', rowId: id })
const isProtected = (value) => value && typeof value === 'object' && value.protected_session

function callbackResult(promise, callback) {
  if (callback) promise.then(value => callback(null, value), error => callback(error))
  return promise
}

// Session IDs and expiration remain queryable; session contents (including CSRF
// tokens and account IDs) are authenticated ciphertext bound to the session ID.
export function protectSessionStore(rawStore, { db, protection = null }) {
  class ProtectedStore extends session.Store {
    constructor() {
      super()
      rawStore.on('error', error => this.emit('error', error))
    }

    get(id, callback) {
      const promise = rawStore.get(id).then(async value => {
        if (!value) return value
        if (isProtected(value)) {
          if (!protection) throw new Error('A chave das sessões protegidas não está configurada.')
          return protection.decryptJSON(value.protected_session, contextFor(id))
        }
        if (protection) {
          // Legacy sessions are migrated before the HTTP server starts. Never
          // accept an unprotected session injected after that migration.
          await rawStore.destroy(id)
          return null
        }
        return value
      })
      return callbackResult(promise, callback)
    }

    set(id, value, callback) {
      const stored = protection
        ? { cookie: value.cookie, protected_session: protection.encryptJSON(value, contextFor(id)) }
        : value
      return callbackResult(rawStore.set(id, stored), callback)
    }

    touch(id, value, callback) { return callbackResult(rawStore.touch(id, value), callback) }
    destroy(id, callback) { return callbackResult(rawStore.destroy(id), callback) }
    clear(callback) { return callbackResult(rawStore.clear(), callback) }
    length(callback) { return callbackResult(rawStore.length(), callback) }

    all(callback) {
      const promise = rawStore.all().then(values => Object.fromEntries(
        Object.entries(values).map(([id, value]) => {
          if (isProtected(value)) {
            if (!protection) throw new Error('A chave das sessões protegidas não está configurada.')
            return [id, protection.decryptJSON(value.protected_session, contextFor(id))]
          }
          if (protection) throw new Error('Sessão sem proteção encontrada após a migração.')
          return [id, value]
        })
      ))
      return callbackResult(promise, callback)
    }

    async migrate() {
      await rawStore.onReady()
      let cursor = ''
      while (true) {
        const [rows] = await db.execute('SELECT session_id FROM sessions WHERE session_id>? ORDER BY session_id LIMIT 200', [cursor])
        if (!rows.length) break
        for (const { session_id: id } of rows) {
          const connection = await db.getConnection()
          try {
            await connection.beginTransaction()
            const [locked] = await connection.execute('SELECT data FROM sessions WHERE session_id=? FOR UPDATE', [id])
            if (locked.length) {
              const value = typeof locked[0].data === 'string' ? JSON.parse(locked[0].data) : locked[0].data
              if (isProtected(value)) {
                if (!protection) throw new Error('Não é possível desativar a proteção de sessões já criptografadas.')
                protection.decryptJSON(value.protected_session, contextFor(id))
              } else if (protection) {
                const envelope = protection.encryptJSON(value, contextFor(id))
                protection.decryptJSON(envelope, contextFor(id))
                await connection.execute('UPDATE sessions SET data=? WHERE session_id=?', [JSON.stringify({ cookie: value.cookie, protected_session: envelope }), id])
              }
            }
            await connection.commit()
          } catch (error) {
            await connection.rollback().catch(() => {})
            throw error
          } finally { connection.release() }
        }
        cursor = rows.at(-1).session_id
      }
    }
  }
  return new ProtectedStore()
}
