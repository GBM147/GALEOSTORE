import { createHash } from 'node:crypto'
import { isIP } from 'node:net'
import { createDatabasePrivacy } from './database-privacy.js'
import { createDataProtection } from './data-protection.js'

// This module never imports the HTTP server, creates tables or calls a media
// provider. The caller supplies one dedicated MySQL connection.
export const DELETE_TABLES = Object.freeze([
  'recurring_expenses', 'payments', 'store_order_items', 'sale_items',
  'stock_movements', 'financial_entries', 'store_orders', 'sales',
  'customer_email_verifications', 'customers', 'product_media', 'products',
  'integration_events'
])
export const PRESERVED_TABLES = Object.freeze([
  'admin_users', 'categories', 'financial_categories', 'financial_accounts',
  'home_sections', 'home_settings', 'media_assets', 'sessions'
])
export const OPERATIONAL_AUDIT_ENTITIES = Object.freeze([
  'produto', 'estoque', 'venda', 'pedido_online',
  'lancamento_financeiro', 'despesa_recorrente'
])

const expectedForeignKeys = Object.freeze([
  ['fk_products_category', 'products', 'category_id', 'categories', 'id', 'SET NULL'],
  ['fk_media_product', 'product_media', 'product_id', 'products', 'id', 'CASCADE'],
  ['fk_stock_product', 'stock_movements', 'product_id', 'products', 'id', 'RESTRICT'],
  ['fk_stock_user', 'stock_movements', 'user_id', 'admin_users', 'id', 'SET NULL'],
  ['fk_fin_account', 'financial_entries', 'account_id', 'financial_accounts', 'id', 'SET NULL'],
  ['fk_fin_category', 'financial_entries', 'category_id', 'financial_categories', 'id', 'SET NULL'],
  ['fk_fin_user', 'financial_entries', 'user_id', 'admin_users', 'id', 'SET NULL'],
  ['fk_rec_category', 'recurring_expenses', 'category_id', 'financial_categories', 'id', 'SET NULL'],
  ['fk_rec_account', 'recurring_expenses', 'account_id', 'financial_accounts', 'id', 'SET NULL'],
  ['fk_sales_user', 'sales', 'user_id', 'admin_users', 'id', 'SET NULL'],
  ['fk_sale_items_sale', 'sale_items', 'sale_id', 'sales', 'id', 'CASCADE'],
  ['fk_sale_items_product', 'sale_items', 'product_id', 'products', 'id', 'RESTRICT'],
  ['fk_audit_user', 'audit_logs', 'user_id', 'admin_users', 'id', 'SET NULL'],
  ['fk_email_verification_customer', 'customer_email_verifications', 'customer_id', 'customers', 'id', 'CASCADE'],
  ['fk_order_customer', 'store_orders', 'customer_id', 'customers', 'id', 'RESTRICT'],
  ['fk_order_item_order', 'store_order_items', 'order_id', 'store_orders', 'id', 'CASCADE'],
  ['fk_order_item_product', 'store_order_items', 'product_id', 'products', 'id', 'RESTRICT'],
  ['fk_payment_order', 'payments', 'store_order_id', 'store_orders', 'id', 'RESTRICT'],
  ['fk_payment_sale', 'payments', 'sale_id', 'sales', 'id', 'RESTRICT'],
  ['fk_home_updated_by', 'home_sections', 'updated_by', 'admin_users', 'id', 'SET NULL'],
  ['fk_home_published_by', 'home_sections', 'published_by', 'admin_users', 'id', 'SET NULL'],
  ['fk_home_setting_user', 'home_settings', 'updated_by', 'admin_users', 'id', 'SET NULL']
])
const allTables = Object.freeze([...DELETE_TABLES, ...PRESERVED_TABLES, 'audit_logs'])
const auditParameters = [...OPERATIONAL_AUDIT_ENTITIES]
const auditPredicate = 'entity IN (' + auditParameters.map(() => '?').join(',') + ')'
const preservedAuditPredicate = '(entity IS NULL OR entity NOT IN (' + auditParameters.map(() => '?').join(',') + '))'
const tableIdentifier = name => '`' + name + '`'

export class CleanupError extends Error {
  constructor(code, message) {
    super(message)
    this.name = 'CleanupError'
    this.code = code
  }
}

function fail(code, message) { throw new CleanupError(code, message) }
function validDatabase(value) { return typeof value === 'string' && /^[A-Za-z0-9_][A-Za-z0-9_$-]{0,63}$/.test(value) }
function validHost(value) { return typeof value === 'string' && /^[A-Za-z0-9._:\[\]-]{1,253}$/.test(value) }
function loopbackHost(value) {
  return value === 'localhost' || value === '::1' || value === '[::1]' ||
    (isIP(value) === 4 && value.split('.')[0] === '127')
}

export function buildCleanupConnectionConfig(env, { targetDatabase, targetHost, allowLocalPlaintext = false } = {}) {
  if (!validDatabase(targetDatabase) || !validHost(targetHost) ||
      env.DB_NAME !== targetDatabase || env.DB_HOST !== targetHost) {
    fail('CLEANUP_TARGET_MISMATCH', 'Os flags de host e banco devem coincidir exatamente com DB_HOST e DB_NAME.')
  }
  if (!env.DB_USER || !env.DB_PASSWORD) fail('CLEANUP_CREDENTIALS_MISSING', 'Configure DB_USER e DB_PASSWORD no ambiente.')
  const port = Number(env.DB_PORT || 3306)
  if (!Number.isInteger(port) || port < 1 || port > 65535) fail('CLEANUP_PORT_INVALID', 'DB_PORT inválida.')
  const local = loopbackHost(targetHost)
  if (allowLocalPlaintext && !local) fail('CLEANUP_TLS_REQUIRED', 'A exceção sem TLS exige um endereço loopback local.')
  const hostname = targetHost.replace(/^\[|\]$/g, '')
  if (!allowLocalPlaintext && (isIP(hostname) !== 0 || /^(?:0x[a-f0-9]+|\d+)(?:\.(?:0x[a-f0-9]+|\d+))*$/i.test(hostname))) {
    // mysql2 skips verifyIdentity for IP host values; a remote TLS target must
    // be a DNS hostname whose identity the driver actually verifies.
    fail('CLEANUP_HOSTNAME_REQUIRED', 'Use o hostname DNS do banco para validar sua identidade TLS; testes em IP loopback podem usar --local-no-tls.')
  }
  if (!allowLocalPlaintext && (env.DB_SSL === 'false' || env.DB_SSL_REJECT_UNAUTHORIZED === 'false')) {
    fail('CLEANUP_TLS_REQUIRED', 'Configure TLS com validação do certificado; a exceção local exige --local-no-tls.')
  }
  return {
    host: targetHost === '[::1]' ? '::1' : targetHost, port, user: env.DB_USER,
    password: env.DB_PASSWORD, database: targetDatabase, connectTimeout: 10000,
    multipleStatements: false, dateStrings: true, jsonStrings: true,
    ssl: allowLocalPlaintext ? undefined : {
      rejectUnauthorized: true, verifyIdentity: true,
      ...(env.DB_SSL_CA ? { ca: env.DB_SSL_CA.replace(/\\n/g, '\n') } : {})
    }
  }
}

export function parseCleanupArgs(argv) {
  const result = { execute: false, backupConfirmed: false, writersStopped: false,
    resetTestBalances: false, allowLocalPlaintext: false, actorId: null }
  const booleans = { '--execute': 'execute', '--backup-confirmed': 'backupConfirmed',
    '--writers-stopped': 'writersStopped', '--reset-test-balances': 'resetTestBalances',
    '--local-no-tls': 'allowLocalPlaintext', '--help': 'help' }
  const values = { '--database': 'targetDatabase', '--host': 'targetHost', '--owner-id': 'actorId' }
  const seen = new Set()
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (seen.has(arg)) fail('CLEANUP_ARGUMENT_INVALID', 'Um flag foi repetido.')
    seen.add(arg)
    if (arg === '--dry-run') continue
    if (booleans[arg]) { result[booleans[arg]] = true; continue }
    if (values[arg]) {
      const value = argv[++i]
      if (!value || value.startsWith('--')) fail('CLEANUP_ARGUMENT_INVALID', 'Um flag obrigatório está sem valor.')
      result[values[arg]] = value
      continue
    }
    fail('CLEANUP_ARGUMENT_INVALID', 'Flag desconhecido; use --help.')
  }
  if (seen.has('--dry-run') && result.execute) fail('CLEANUP_ARGUMENT_INVALID', 'Escolha dry-run ou execução.')
  if (result.help) return result
  if (!validDatabase(result.targetDatabase) || !validHost(result.targetHost)) {
    fail('CLEANUP_TARGET_REQUIRED', 'Informe explicitamente --host e --database.')
  }
  if (result.actorId !== null) {
    if (!/^[1-9]\d*$/.test(result.actorId) || !Number.isSafeInteger(Number(result.actorId))) {
      fail('CLEANUP_ACTOR_INVALID', 'Informe um ID de proprietário válido.')
    }
    result.actorId = Number(result.actorId)
  }
  return result
}

export function validateCleanupSchema({ tables, foreignKeys, triggers = [], events = [], targetDatabase }) {
  if (!Array.isArray(tables) || !Array.isArray(foreignKeys)) fail('CLEANUP_SCHEMA_INVALID', 'Não foi possível conferir o schema.')
  const names = new Set()
  for (const table of tables) {
    const name = table.TABLE_NAME ?? table.table_name
    if (!allTables.includes(name) || names.has(name)) fail('CLEANUP_SCHEMA_UNKNOWN', 'Há tabela desconhecida ou duplicada; revise o plano antes de continuar.')
    if ((table.TABLE_TYPE ?? table.table_type ?? 'BASE TABLE') !== 'BASE TABLE' ||
        String(table.ENGINE ?? table.engine).toUpperCase() !== 'INNODB') {
      fail('CLEANUP_ENGINE_UNSAFE', 'Todas as tabelas devem ser tabelas InnoDB transacionais.')
    }
    names.add(name)
  }
  if (allTables.some(name => name !== 'media_assets' && !names.has(name))) {
    fail('CLEANUP_SCHEMA_MISSING', 'Uma tabela esperada está ausente; revise o schema antes de continuar.')
  }
  if (triggers.length) fail('CLEANUP_TRIGGER_UNKNOWN', 'Há trigger não prevista; revise seus efeitos antes de continuar.')
  if (events.length) fail('CLEANUP_EVENT_UNKNOWN', 'Há evento agendado no banco; revise suas escritas antes de continuar.')
  const expected = new Map(expectedForeignKeys.map(fk => [fk[0], fk]))
  const found = new Set()
  for (const row of foreignKeys) {
    const key = row.CONSTRAINT_NAME ?? row.constraint_name
    const fk = expected.get(key)
    const signature = [key, row.TABLE_NAME ?? row.table_name, row.COLUMN_NAME ?? row.column_name,
      row.REFERENCED_TABLE_NAME ?? row.referenced_table_name, row.REFERENCED_COLUMN_NAME ?? row.referenced_column_name,
      String(row.DELETE_RULE ?? row.delete_rule).toUpperCase()]
    const tableSchema = row.TABLE_SCHEMA ?? row.table_schema
    const referencedSchema = row.REFERENCED_TABLE_SCHEMA ?? row.referenced_table_schema
    const updateRule = String(row.UPDATE_RULE ?? row.update_rule).toUpperCase()
    if (!fk || found.has(key) || JSON.stringify(fk) !== JSON.stringify(signature) ||
        (targetDatabase && (tableSchema !== targetDatabase || referencedSchema !== targetDatabase)) ||
        !['RESTRICT', 'NO ACTION'].includes(updateRule)) {
      fail('CLEANUP_FK_UNKNOWN', 'Há FK desconhecida, alterada ou externa; revise suas dependências antes de continuar.')
    }
    found.add(key)
  }
  if (found.size !== expected.size) fail('CLEANUP_FK_MISSING', 'Uma FK esperada está ausente; revise o schema antes de continuar.')
  return [...names].sort()
}

export function validateCleanupMetadataVisibility(grants) {
  if (!Array.isArray(grants) || !grants.length) fail('CLEANUP_SCHEMA_VISIBILITY_UNPROVEN', 'Não foi possível comprovar a visibilidade integral do schema.')
  const privileges = new Set()
  for (const row of grants) {
    const values = Object.values(row)
    if (values.length !== 1 || typeof values[0] !== 'string') fail('CLEANUP_SCHEMA_VISIBILITY_UNPROVEN', 'Não foi possível comprovar a visibilidade integral do schema.')
    const statement = values[0]
    // Partial revokes can restrict an otherwise global privilege. Role grants
    // are not expanded here; required privileges must be granted directly.
    if (/^\s*REVOKE\b/i.test(statement)) fail('CLEANUP_SCHEMA_VISIBILITY_UNPROVEN', 'Há restrições de privilégios; não foi possível comprovar a visibilidade integral do schema.')
    const global = statement.match(/^\s*GRANT\s+(.+?)\s+ON\s+\*\.\*\s+TO\s+/is)
    if (!global) continue
    for (const value of global[1].split(',').map(item => item.trim().toUpperCase())) {
      if (value === 'ALL PRIVILEGES') { privileges.add('SELECT'); privileges.add('TRIGGER'); privileges.add('EVENT') }
      else privileges.add(value)
    }
  }
  if (!['SELECT', 'TRIGGER', 'EVENT'].every(privilege => privileges.has(privilege))) {
    fail('CLEANUP_SCHEMA_VISIBILITY_UNPROVEN', 'A execução exige SELECT, TRIGGER e EVENT globais diretos para comprovar todas as dependências, sem bypass ou concessão automática.')
  }
  return true
}

function contentObject(content) {
  let parsed = content
  if (typeof parsed === 'string') {
    try { parsed = JSON.parse(parsed) } catch { fail('CLEANUP_HOME_INVALID', 'O conteúdo da Home não é JSON válido.') }
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    fail('CLEANUP_HOME_INVALID', 'O conteúdo da Home deve ser um objeto.')
  }
  return parsed
}

function productId(value) {
  if (typeof value === 'number' && Number.isSafeInteger(value) && value > 0) return String(value)
  if (typeof value === 'string' && /^\d+$/.test(value) && Number.isSafeInteger(Number(value)) && Number(value) > 0) return String(Number(value))
  return null
}

export function removeDeletedProductReferences(content, deletedProductIds) {
  const original = contentObject(content)
  if (!Object.hasOwn(original, 'product_ids')) return original
  if (!Array.isArray(original.product_ids)) fail('CLEANUP_HOME_INVALID', 'A seleção de produtos da Home deve ser uma lista.')
  const deleted = new Set([...deletedProductIds].map(productId).filter(Boolean))
  return { ...original, product_ids: original.product_ids.filter(id => !deleted.has(productId(id))) }
}

async function rows(connection, sql, parameters = []) {
  const [result] = await connection.execute(sql, parameters)
  return result
}

async function inspectSchema(connection, targetDatabase) {
  const tables = await rows(connection,
    'SELECT TABLE_NAME,ENGINE,TABLE_TYPE,AUTO_INCREMENT FROM information_schema.TABLES WHERE TABLE_SCHEMA=?', [targetDatabase])
  const foreignKeys = await rows(connection,
    `SELECT k.CONSTRAINT_NAME,k.TABLE_SCHEMA,k.TABLE_NAME,k.COLUMN_NAME,
      k.REFERENCED_TABLE_SCHEMA,k.REFERENCED_TABLE_NAME,k.REFERENCED_COLUMN_NAME,r.DELETE_RULE,r.UPDATE_RULE
     FROM information_schema.KEY_COLUMN_USAGE k
     JOIN information_schema.REFERENTIAL_CONSTRAINTS r
       ON r.CONSTRAINT_SCHEMA=k.CONSTRAINT_SCHEMA AND r.CONSTRAINT_NAME=k.CONSTRAINT_NAME AND r.TABLE_NAME=k.TABLE_NAME
     WHERE k.REFERENCED_TABLE_NAME IS NOT NULL AND (k.TABLE_SCHEMA=? OR k.REFERENCED_TABLE_SCHEMA=?)`, [targetDatabase, targetDatabase])
  const triggers = await rows(connection,
    'SELECT TRIGGER_NAME FROM information_schema.TRIGGERS WHERE TRIGGER_SCHEMA=?', [targetDatabase])
  const events = await rows(connection,
    'SELECT EVENT_NAME FROM information_schema.EVENTS WHERE EVENT_SCHEMA=?', [targetDatabase])
  const names = validateCleanupSchema({ tables, foreignKeys, triggers, events, targetDatabase })
  const keys = await rows(connection,
    "SELECT TABLE_NAME,COLUMN_NAME,SEQ_IN_INDEX FROM information_schema.STATISTICS WHERE TABLE_SCHEMA=? AND INDEX_NAME='PRIMARY' ORDER BY TABLE_NAME,SEQ_IN_INDEX", [targetDatabase])
  const primaryKeys = new Map(names.map(name => [name, []]))
  for (const key of keys) {
    if (!primaryKeys.has(key.TABLE_NAME) || !/^[a-z_]+$/.test(key.COLUMN_NAME)) fail('CLEANUP_SCHEMA_INVALID', 'Chave primária não prevista.')
    primaryKeys.get(key.TABLE_NAME).push(key.COLUMN_NAME)
  }
  const expectedPrimary = { sessions: 'session_id', home_settings: 'setting_key', customer_email_verifications: 'token_hash' }
  if ([...primaryKeys].some(([table, list]) => list.length !== 1 || list[0] !== (expectedPrimary[table] || 'id'))) {
    fail('CLEANUP_SCHEMA_INVALID', 'Todas as tabelas devem ter a chave primária simples prevista pelo schema.')
  }
  const columns = await rows(connection,
    "SELECT TABLE_NAME,COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=? AND COLUMN_NAME='private_data'", [targetDatabase])
  return { names, primaryKeys, tables, privateTables: new Set(columns.map(column => column.TABLE_NAME)) }
}

function count(value) {
  const numeric = Number(value)
  if (!Number.isSafeInteger(numeric) || numeric < 0) fail('CLEANUP_COUNT_INVALID', 'A contagem excede os limites seguros da ferramenta.')
  return numeric
}

async function summarize(connection, names) {
  const counts = {}
  for (const table of names) counts[table] = count((await rows(connection, 'SELECT COUNT(*) AS total FROM ' + tableIdentifier(table)))[0].total)
  const audit = await rows(connection, 'SELECT COUNT(*) AS total FROM audit_logs WHERE ' + auditPredicate, auditParameters)
  const balances = await rows(connection, 'SELECT COUNT(*) AS total FROM financial_accounts WHERE initial_balance<>0')
  const stock = await rows(connection, 'SELECT COALESCE(SUM(stock),0) AS total FROM products')
  const units = Number(stock[0].total)
  if (!Number.isSafeInteger(units)) fail('CLEANUP_COUNT_INVALID', 'O estoque excede os limites seguros da ferramenta.')
  return { counts, operational_audit_logs: count(audit[0].total), accounts_with_test_balance: count(balances[0].total), stock_units: units }
}

function canonical(value) {
  if (Buffer.isBuffer(value)) return { bytes: value.toString('hex') }
  if (value instanceof Date) return value.toISOString()
  if (typeof value === 'bigint') return value.toString()
  if (Array.isArray(value)) return value.map(canonical)
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])]))
  return value
}

function normalizeJsonColumns(row) {
  const result = { ...row }
  for (const key of ['draft_content', 'published_content', 'setting_value', 'draft_value', 'private_data', 'details']) {
    if (typeof result[key] === 'string') {
      try { result[key] = JSON.parse(result[key]) } catch { fail('CLEANUP_PRESERVATION_INVALID', 'Uma coluna JSON preservada é inválida.') }
    }
  }
  return result
}

function expectedHomeRow(row, deletedIds) {
  if (row.section_key !== 'featured_products' && row.section_type !== 'featured_products') return row
  return { ...row, draft_content: removeDeletedProductReferences(row.draft_content, deletedIds),
    published_content: removeDeletedProductReferences(row.published_content, deletedIds) }
}

async function preservedDigests(connection, schema, deletedIds, expectedChanges = false, sessionChanges = new Map()) {
  const result = {}
  for (const table of [...PRESERVED_TABLES, 'audit_logs'].filter(name => schema.names.includes(name))) {
    const digest = createHash('sha256')
    const primaryKey = schema.primaryKeys.get(table)[0]
    const predicate = table === 'audit_logs' ? ' WHERE ' + preservedAuditPredicate : ''
    const parameters = table === 'audit_logs' ? auditParameters : []
    let offset = 0
    while (true) {
      const batch = await rows(connection, 'SELECT * FROM ' + tableIdentifier(table) + predicate +
        ' ORDER BY ' + tableIdentifier(primaryKey) + ' LIMIT 200 OFFSET ' + offset, parameters)
      for (const original of batch) {
        if (expectedChanges && table === 'sessions' && sessionChanges.has(original.session_id) && sessionChanges.get(original.session_id) === null) continue
        let record = normalizeJsonColumns(original)
        if (expectedChanges && table === 'financial_accounts') record = { ...record, initial_balance: '0.00' }
        if (expectedChanges && table === 'home_sections') record = expectedHomeRow(record, deletedIds)
        if (expectedChanges && table === 'sessions' && sessionChanges.has(record.session_id)) record = sessionChanges.get(record.session_id)
        digest.update(JSON.stringify(canonical(record)) + '\n')
      }
      if (batch.length < 200) break
      offset += batch.length
    }
    result[table] = digest.digest('hex')
  }
  return result
}

async function validatePrivacyMode(connection, schema, enabled) {
  for (const table of ['admin_users', 'audit_logs']) {
    if (!schema.privateTables.has(table)) {
      if (enabled) fail('CLEANUP_PRIVACY_SCHEMA_MISSING', 'A proteção está habilitada, mas o schema privado está incompleto.')
      continue
    }
    if (!enabled) {
      const [protectedRow] = await rows(connection, 'SELECT 1 AS present FROM ' + tableIdentifier(table) + ' WHERE private_data IS NOT NULL LIMIT 1')
      if (protectedRow) fail('CLEANUP_PRIVACY_DOWNGRADE', 'O banco tem dados protegidos; configure a proteção e sua chave antes de executar.')
    }
  }
}

async function validatePreservedPrivateRows(connection, schema, privacy, enabled) {
  if (!enabled) return
  for (const table of ['admin_users', 'audit_logs']) {
    if (!schema.privateTables.has(table)) continue
    let cursor = 0
    while (true) {
      const predicate = table === 'audit_logs' ? ' AND ' + preservedAuditPredicate : ''
      const parameters = table === 'audit_logs' ? [cursor, ...auditParameters] : [cursor]
      const batch = await rows(connection, 'SELECT * FROM ' + tableIdentifier(table) + ' WHERE id>? AND private_data IS NOT NULL' + predicate + ' ORDER BY id LIMIT 200', parameters)
      for (const record of batch) privacy.decodeRow(table, record)
      if (batch.length < 200) break
      cursor = batch.at(-1).id
    }
  }
}

function sessionObject(value) {
  let result = value
  if (typeof result === 'string') {
    try { result = JSON.parse(result) } catch { fail('CLEANUP_SESSION_INVALID', 'Há uma sessão com JSON inválido; revise antes de executar.') }
  }
  if (!result || typeof result !== 'object' || Array.isArray(result)) fail('CLEANUP_SESSION_INVALID', 'Há uma sessão com estrutura inválida; revise antes de executar.')
  return result
}

async function planSessionChanges(connection, enabled) {
  const protection = enabled ? createDataProtection() : null
  const changes = new Map()
  const admins = await rows(connection, 'SELECT id FROM admin_users WHERE active=1')
  const activeAdmins = new Set(admins.map(admin => String(admin.id)))
  let offset = 0
  while (true) {
    const batch = await rows(connection, 'SELECT session_id,expires,data FROM sessions ORDER BY session_id LIMIT 200 OFFSET ' + offset)
    for (const record of batch) {
      const stored = sessionObject(record.data)
      const encrypted = Object.hasOwn(stored, 'protected_session')
      const context = { table: 'sessions', field: 'data', rowId: record.session_id }
      if (encrypted && !protection) fail('CLEANUP_PRIVACY_DOWNGRADE', 'Há sessões protegidas; configure a proteção e sua chave antes de executar.')
      const value = encrypted ? sessionObject(protection.decryptJSON(stored.protected_session, context)) : stored
      if (!Object.hasOwn(value, 'customerId')) continue
      if (!productId(value.customerId)) fail('CLEANUP_SESSION_INVALID', 'Há uma sessão com identidade de cliente inválida; revise antes de executar.')
      if (value.userId != null && !productId(value.userId)) fail('CLEANUP_SESSION_INVALID', 'Há uma sessão com identidade administrativa inválida; revise antes de executar.')
      if (value.userId != null && activeAdmins.has(String(Number(value.userId)))) {
        const retained = { ...value }
        delete retained.customerId
        const updated = encrypted ? { ...stored, protected_session: protection.encryptJSON(retained, context) } : retained
        // Verify the new envelope before modifying any row.
        if (encrypted && JSON.stringify(protection.decryptJSON(updated.protected_session, context)) !== JSON.stringify(retained)) {
          fail('CLEANUP_SESSION_INVALID', 'Não foi possível validar a sessão administrativa preservada.')
        }
        changes.set(record.session_id, { ...record, data: JSON.stringify(updated) })
      } else {
        changes.set(record.session_id, null)
      }
    }
    if (batch.length < 200) break
    offset += batch.length
  }
  return changes
}

export async function runTestDataCleanup({ connection, targetDatabase, execute = false,
  backupConfirmed = false, writersStopped = false, resetTestBalances = false,
  actorId = null, privacyEnabled = process.env.DATA_ENCRYPTION_ENABLED === 'true' } = {}) {
  if (!connection || typeof connection.execute !== 'function' || !validDatabase(targetDatabase)) {
    fail('CLEANUP_TARGET_REQUIRED', 'Forneça uma conexão dedicada e o banco alvo explícito.')
  }
  if ([execute, backupConfirmed, writersStopped, resetTestBalances, privacyEnabled].some(flag => typeof flag !== 'boolean')) {
    fail('CLEANUP_ARGUMENT_INVALID', 'As declarações de execução, manutenção, backup e proteção devem ser booleanas explícitas.')
  }
  if (execute && (!backupConfirmed || !writersStopped)) {
    fail('CLEANUP_CONFIRMATIONS_REQUIRED', 'A execução exige backup recuperável confirmado e todos os escritores interrompidos.')
  }
  if (execute && (!Number.isSafeInteger(actorId) || actorId < 1)) fail('CLEANUP_ACTOR_INVALID', 'A execução exige o ID de um proprietário ativo.')
  const [identity] = await rows(connection, 'SELECT DATABASE() AS database_name')
  if (identity?.database_name !== targetDatabase) fail('CLEANUP_TARGET_MISMATCH', 'O banco conectado não coincide com o alvo explícito.')
  let grants
  try { grants = await connection.query('SHOW GRANTS FOR CURRENT_USER') }
  catch { fail('CLEANUP_SCHEMA_VISIBILITY_UNPROVEN', 'Não foi possível comprovar a visibilidade integral do schema.') }
  validateCleanupMetadataVisibility(grants[0])
  let schema = await inspectSchema(connection, targetDatabase)
  if (!execute) return { mode: 'dry-run', before: await summarize(connection, schema.names), after: null }
  let transactionStarted = false
  let commitAttempted = false
  try {
    // Range locks protect the preservation check and the deletion against
    // accidental writers during execution. They do not replace maintenance.
    await connection.query('SET TRANSACTION ISOLATION LEVEL SERIALIZABLE')
    await connection.beginTransaction()
    transactionStarted = true
    for (const table of schema.names) {
      const key = schema.primaryKeys.get(table)[0]
      await rows(connection, 'SELECT ' + tableIdentifier(key) + ' FROM ' + tableIdentifier(table) + ' FOR UPDATE')
    }
    schema = await inspectSchema(connection, targetDatabase)
    const [actor] = await rows(connection, "SELECT id FROM admin_users WHERE id=? AND role='owner' AND active=1", [actorId])
    if (!actor) fail('CLEANUP_ACTOR_INVALID', 'O proprietário informado não está ativo neste banco.')
    await validatePrivacyMode(connection, schema, privacyEnabled)
    const privacy = createDatabasePrivacy({ db: connection, enabled: privacyEnabled })
    await validatePreservedPrivateRows(connection, schema, privacy, privacyEnabled)
    const sessionChanges = await planSessionChanges(connection, privacyEnabled)
    const before = await summarize(connection, schema.names)
    if (before.accounts_with_test_balance && !resetTestBalances) {
      fail('CLEANUP_BALANCES_CONFIRMATION_REQUIRED', 'Há saldos iniciais; confirme explicitamente que são dados de teste com --reset-test-balances.')
    }
    const productRows = await rows(connection, 'SELECT id FROM products ORDER BY id')
    if (productRows.some(row => !productId(row.id))) fail('CLEANUP_PRODUCT_ID_INVALID', 'Há um identificador de produto fora do formato esperado; revise os dados antes de executar.')
    const deletedIds = new Set(productRows.map(row => row.id))
    const expectedDigests = await preservedDigests(connection, schema, deletedIds, true, sessionChanges)
    const featured = await rows(connection,
      "SELECT id,draft_content,published_content FROM home_sections WHERE section_key='featured_products' OR section_type='featured_products'")
    for (const row of featured) {
      const draft = removeDeletedProductReferences(row.draft_content, deletedIds)
      const published = removeDeletedProductReferences(row.published_content, deletedIds)
      if (JSON.stringify(canonical(contentObject(row.draft_content))) !== JSON.stringify(canonical(draft)) ||
          JSON.stringify(canonical(contentObject(row.published_content))) !== JSON.stringify(canonical(published))) {
        await rows(connection, 'UPDATE home_sections SET draft_content=?,published_content=?,updated_at=updated_at WHERE id=?',
          [JSON.stringify(draft), JSON.stringify(published), row.id])
      }
    }
    await rows(connection, 'DELETE FROM audit_logs WHERE ' + auditPredicate, auditParameters)
    for (const table of DELETE_TABLES) await rows(connection, 'DELETE FROM ' + tableIdentifier(table))
    await rows(connection, 'UPDATE financial_accounts SET initial_balance=0 WHERE initial_balance<>0')
    for (const [id, record] of sessionChanges) {
      if (record === null) await rows(connection, 'DELETE FROM sessions WHERE session_id=?', [id])
      else await rows(connection, 'UPDATE sessions SET data=? WHERE session_id=?', [record.data, id])
    }
    const after = await summarize(connection, schema.names)
    if (DELETE_TABLES.some(table => after.counts[table] !== 0) || after.operational_audit_logs !== 0 ||
        after.accounts_with_test_balance !== 0 || after.stock_units !== 0) {
      fail('CLEANUP_NOT_EMPTY', 'A verificação encontrou dados operacionais remanescentes; a transação será revertida.')
    }
    const actualDigests = await preservedDigests(connection, schema, deletedIds)
    if (JSON.stringify(expectedDigests) !== JSON.stringify(actualDigests)) {
      fail('CLEANUP_PRESERVATION_FAILED', 'A verificação dos dados preservados falhou; a transação será revertida.')
    }
    const finalSchema = await inspectSchema(connection, targetDatabase)
    for (const table of schema.tables) {
      if (DELETE_TABLES.includes(table.TABLE_NAME) &&
          String(table.AUTO_INCREMENT) !== String(finalSchema.tables.find(item => item.TABLE_NAME === table.TABLE_NAME)?.AUTO_INCREMENT)) {
        fail('CLEANUP_IDS_CHANGED', 'Uma sequência de IDs foi alterada; a transação será revertida.')
      }
    }
    const details = { scope: 'all_operational_test_data', removed: Object.fromEntries(DELETE_TABLES.map(table => [table, before.counts[table]])),
      removed_operational_audits: before.operational_audit_logs, reset_test_balances: before.accounts_with_test_balance,
      removed_customer_sessions: [...sessionChanges.values()].filter(record => record === null).length,
      preserved_mixed_sessions: [...sessionChanges.values()].filter(record => record !== null).length }
    const pending = privacy.pendingFields('audit_logs', { details })
    const inserted = await rows(connection,
      "INSERT INTO audit_logs(user_id,action,entity,entity_id,details) VALUES(?,'RESET_TEST_DATA','operational_data',NULL,?)", [actorId, pending.details])
    await privacy.completeInsert('audit_logs', inserted.insertId, { details }, connection)
    after.counts.audit_logs += 1
    commitAttempted = true
    await connection.commit()
    transactionStarted = false
    return { mode: 'executed', before, after, preservation_verified: true }
  } catch (error) {
    if (transactionStarted) await connection.rollback().catch(() => {})
    if (commitAttempted) {
      fail('CLEANUP_COMMIT_UNKNOWN', 'Não foi possível confirmar a resposta do commit. Confira o estado do banco e os registros preservados antes de repetir; o rollback posterior não comprova reversão.')
    }
    throw error
  }
}
