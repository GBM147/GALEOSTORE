const unreadableGlobalSettingCodes = new Set([
  'ER_SPECIFIC_ACCESS_DENIED_ERROR',
  'ER_ACCESS_DENIED_ERROR',
  'ER_TABLEACCESS_DENIED_ERROR',
  'ER_DBACCESS_DENIED_ERROR',
  'ER_UNKNOWN_SYSTEM_VARIABLE'
])

const statusValue = (rows, name) => {
  const row = rows.find(item => String(item.Variable_name).toLowerCase() === name.toLowerCase())
  return typeof row?.Value === 'string' && row.Value.trim() ? row.Value.trim() : null
}

// Inspect a single connection used by the application. Configuration alone
// does not prove that this MySQL session actually negotiated TLS.
export async function inspectMySqlSecurity({ db, sslEnabled, verifyCertificate, verifyHostname, caConfigured }) {
  const connection = await db.getConnection()
  try {
    const [sessionStatus] = await connection.query("SHOW SESSION STATUS WHERE Variable_name IN ('Ssl_cipher','Ssl_version')")
    const cipher = statusValue(sessionStatus, 'Ssl_cipher')
    const protocol = statusValue(sessionStatus, 'Ssl_version')
    const negotiated = Boolean(cipher)
    let serverRequiresTls = null
    try {
      const [globalVariables] = await connection.query("SHOW GLOBAL VARIABLES LIKE 'require_secure_transport'")
      const setting = statusValue(globalVariables, 'require_secure_transport')?.toUpperCase()
      if (setting === 'ON') serverRequiresTls = true
      if (setting === 'OFF') serverRequiresTls = false
    } catch (error) {
      // Restricted database users or older MySQL versions may not expose this
      // setting. Transport/query failures must still fail the diagnosis.
      if (!unreadableGlobalSettingCodes.has(error?.code)) throw error
    }
    const certificateVerified = Boolean(sslEnabled && verifyCertificate && negotiated)
    return {
      enabled: Boolean(sslEnabled),
      negotiated,
      cipher,
      protocol,
      certificate_verified: certificateVerified,
      hostname_verified: Boolean(certificateVerified && verifyHostname),
      ca_configured: Boolean(caConfigured),
      server_requires_tls: serverRequiresTls
    }
  } finally {
    connection.release()
  }
}
