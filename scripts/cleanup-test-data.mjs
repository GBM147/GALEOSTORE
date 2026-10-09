import mysql from 'mysql2/promise'
import { CleanupError, parseCleanupArgs, buildCleanupConnectionConfig, runTestDataCleanup } from '../server/test-data-cleanup.js'

const help = `Inspecionar dados de teste (padrão: somente leitura):
  node scripts/cleanup-test-data.mjs --host HOST --database DATABASE

Executar somente após backup recuperável e manutenção:
  node scripts/cleanup-test-data.mjs --host HOST --database DATABASE --execute \\
    --backup-confirmed --writers-stopped --owner-id ID [--reset-test-balances]

Credenciais: DB_HOST, DB_NAME, DB_USER, DB_PASSWORD e DB_PORT no ambiente.
TLS: certificado e hostname verificados; DB_SSL_CA pode fornecer a CA PEM.
--local-no-tls permite conexão sem TLS somente para testes em loopback.
DATA_ENCRYPTION_ENABLED e sua chave devem coincidir com a proteção do banco.
Não cria schema, não exporta dados pessoais e não exclui arquivos Cloudinary.
Os flags de backup/manutenção são declarações do operador, não verificações
automáticas de que os demais processos estão parados ou de que o backup restaura.`

let connection
try {
  const options = parseCleanupArgs(process.argv.slice(2))
  if (options.help) {
    process.stdout.write(help + '\n')
  } else {
    const config = buildCleanupConnectionConfig(process.env, options)
    // Validate execution declarations before opening a network connection.
    if (options.execute && (!options.backupConfirmed || !options.writersStopped || !options.actorId)) {
      throw new CleanupError('CLEANUP_CONFIRMATIONS_REQUIRED', 'A execução exige backup, manutenção e --owner-id.')
    }
    connection = await mysql.createConnection(config)
    if (config.ssl) {
      const [status] = await connection.query("SHOW SESSION STATUS LIKE 'Ssl_cipher'")
      if (!status.some(row => row.Value)) throw new CleanupError('CLEANUP_TLS_REQUIRED', 'A sessão MySQL não negociou TLS.')
    }
    const result = await runTestDataCleanup({ connection, ...options })
    process.stdout.write(JSON.stringify(result, null, 2) + '\n')
  }
} catch (error) {
  // MySQL errors can contain hostnames, SQL and confidential row values.
  // Only deliberate fixed messages from this tool may reach its output.
  if (error instanceof CleanupError) process.stderr.write(error.code + ': ' + error.message + '\n')
  else process.stderr.write('CLEANUP_FAILED: Falha na operação. Confira o acesso, a configuração e o estado do banco antes de repetir. Detalhes confidenciais não serão exibidos.\n')
  process.exitCode = 1
} finally {
  if (connection) await connection.end().catch(() => {})
}
