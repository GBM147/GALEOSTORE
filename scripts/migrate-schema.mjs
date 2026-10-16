// Explicit migration, separate from every request and from the frontend build.
// Uses the same DB configuration and locks as the regular server initialization.
process.env.GALEO_SERVERLESS = 'true'
const api = await import('../server/index.js')
try {
  await api.migrateSchema()
  console.log('Schema GALEO atualizado. Dados existentes preservados.')
} catch (error) {
  console.error('Não foi possível preparar o banco:', error?.code === 'ADMIN_PASSWORD_INVALID' ? error.message : error?.code || 'MIGRATION_FAILED')
  process.exitCode = 1
} finally {
  await api.closeRuntime()
}
