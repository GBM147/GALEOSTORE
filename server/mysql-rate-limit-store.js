import { createHash } from 'node:crypto'

export const RATE_LIMIT_DDL = `CREATE TABLE IF NOT EXISTS rate_limit_counters (
  bucket_key BINARY(32) NOT NULL PRIMARY KEY,
  hits INT UNSIGNED NOT NULL,
  reset_at BIGINT UNSIGNED NOT NULL,
  INDEX idx_rate_limit_expiry(reset_at)
) ENGINE=InnoDB`

const databaseNow = 'CAST(UNIX_TIMESTAMP(CURRENT_TIMESTAMP(3))*1000 AS UNSIGNED)'

// One shared counter per limiter and client; no IP address or account details
// are stored. A row lock makes increment + returned hit count atomic across
// independent serverless instances.
export class MySqlRateLimitStore {
  localKeys = false
  constructor(db, namespace) {
    if (!db?.getConnection || !/^[a-z][a-z0-9-]{0,79}$/.test(namespace || '')) throw new Error('Configuração inválida do limite de tentativas.')
    this.db = db
    this.prefix = namespace
  }
  init({ windowMs }) {
    if (!Number.isSafeInteger(windowMs) || windowMs <= 0) throw new Error('Janela inválida do limite de tentativas.')
    this.windowMs = windowMs
  }
  key(value) { return createHash('sha256').update(this.prefix + '\0' + value).digest() }
  async increment(key) {
    if (!this.windowMs) throw new Error('Limite de tentativas não inicializado.')
    const connection = await this.db.getConnection()
    try {
      await connection.beginTransaction()
      await connection.execute(`INSERT INTO rate_limit_counters(bucket_key,hits,reset_at)
        VALUES(?,1,${databaseNow}+?) ON DUPLICATE KEY UPDATE
        hits=IF(reset_at<=${databaseNow},1,hits+1),
        reset_at=IF(reset_at<=${databaseNow},VALUES(reset_at),reset_at)`, [this.key(key), this.windowMs])
      const [rows] = await connection.execute('SELECT hits,reset_at FROM rate_limit_counters WHERE bucket_key=?', [this.key(key)])
      await connection.commit()
      return { totalHits: Number(rows[0].hits), resetTime: new Date(Number(rows[0].reset_at)) }
    } catch (error) {
      await connection.rollback().catch(() => {})
      throw error
    } finally { connection.release() }
  }
  async decrement(key) {
    await this.db.execute('UPDATE rate_limit_counters SET hits=IF(hits>0,hits-1,0) WHERE bucket_key=?', [this.key(key)])
  }
  async resetKey(key) {
    await this.db.execute('DELETE FROM rate_limit_counters WHERE bucket_key=?', [this.key(key)])
  }
}

export async function pruneRateLimits(db) {
  const [result] = await db.execute(`DELETE FROM rate_limit_counters WHERE reset_at<=${databaseNow}`)
  return Number(result.affectedRows || 0)
}
