// Homologation only: keeps the stage test customer usable by automated payment
// tests. It never runs against a non-test database or outside Mercado Pago test
// mode, and it never logs the account or its credentials.
export function stageCustomerConfig(env = process.env) {
  const email = String(env.GALEO_STAGE_CUSTOMER_EMAIL || '').trim().toLowerCase()
  const password = String(env.GALEO_STAGE_CUSTOMER_PASSWORD || '')
  if (!email || !password) return null
  if (!/_test$/.test(String(env.DB_NAME || '')) || env.MERCADO_PAGO_MODE !== 'test') return null
  if (!/^\S+@\S+\.\S+$/.test(email) || email.length > 255) return null
  return { email, password }
}

export async function syncStageCustomer({ env = process.env, db, privacy, bcrypt, newPasswordError }) {
  const config = stageCustomerConfig(env)
  if (!config) return { status: 'skipped' }
  if (newPasswordError(config.password)) return { status: 'invalid_password' }
  const conn = await db.getConnection()
  try {
    await conn.beginTransaction()
    const [rows] = await conn.execute('SELECT id,password_hash,active,email_verified_at FROM customers WHERE email=? LIMIT 1 FOR UPDATE', [privacy.emailForLookup('customers', config.email)])
    let status = 'unchanged'
    if (!rows.length) {
      const passwordHash = await bcrypt.hash(config.password, 12)
      const personal = { name: 'Cliente de homologação', email: config.email, phone: '' }
      const safe = privacy.pendingFields('customers', personal)
      const [result] = await conn.execute('INSERT INTO customers(name,email,password_hash,phone,email_verified_at) VALUES(?,?,?,?,UTC_TIMESTAMP())', [safe.name, safe.email, passwordHash, safe.phone])
      await privacy.completeInsert('customers', result.insertId, personal, conn)
      status = 'created'
    } else {
      const customer = rows[0]
      const matches = await bcrypt.compare(config.password, customer.password_hash)
      if (!matches || !customer.active || !customer.email_verified_at) {
        const passwordHash = matches ? customer.password_hash : await bcrypt.hash(config.password, 12)
        await conn.execute('UPDATE customers SET password_hash=?, active=1, email_verified_at=COALESCE(email_verified_at, UTC_TIMESTAMP()) WHERE id=?', [passwordHash, customer.id])
        status = 'updated'
      }
    }
    await conn.commit()
    return { status }
  } catch (error) {
    await conn.rollback().catch(() => {})
    throw error
  } finally {
    conn.release()
  }
}
