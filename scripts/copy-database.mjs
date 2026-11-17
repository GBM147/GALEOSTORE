#!/usr/bin/env node
// Copies every table of one MySQL-compatible database into another (for example
// the Aiven MySQL into TiDB Cloud), keeping ids and the next id of each table,
// then proves the copy row by row with hashes.
//
//   SOURCE_DB_HOST=... SOURCE_DB_USER=... SOURCE_DB_PASSWORD=... SOURCE_DB_NAME=...
//   DB_HOST=... DB_USER=... DB_PASSWORD=... DB_NAME=...      (destination)
//   npm run db:copy -- [--replace] [--verify-only] [--summary <file>]
//
// Optional per side: *_DB_PORT (3306), *_DB_SSL (true), *_DB_SSL_CA,
// *_DB_SSL_REJECT_UNAUTHORIZED (true), the same rules as server/index.js.
// Prints table names, row counts and OK/DIFF only; never row contents.
import { createHash } from 'node:crypto'
import { writeFile } from 'node:fs/promises'
import { pathToFileURL } from 'node:url'
import mysql from 'mysql2/promise'

export function options(argv) {
  const result = { replace: false, verifyOnly: false, summary: '' }
  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index]
    if (arg === '--replace') result.replace = true
    else if (arg === '--verify-only') result.verifyOnly = true
    else if (arg === '--summary') result.summary = argv[++index] || ''
    else throw new Error('Opção desconhecida: ' + arg)
  }
  return result
}

export function connectionConfig(env, prefix) {
  const value = key => String(env[prefix + key] ?? '').trim()
  for (const key of ['HOST', 'USER', 'PASSWORD', 'NAME']) {
    if (!value(key)) throw new Error(prefix + key + ' não configurada')
  }
  const ssl = value('SSL') !== 'false'
  const ca = value('SSL_CA')
  return {
    host: value('HOST'),
    port: Number(value('PORT') || 3306),
    user: value('USER'),
    password: String(env[prefix + 'PASSWORD']),
    database: value('NAME'),
    charset: 'utf8mb4',
    timezone: 'Z',
    dateStrings: true,
    supportBigNumbers: true,
    bigNumberStrings: true,
    decimalNumbers: false,
    // JSON stays text so it is written back verbatim and hashed canonically.
    typeCast: (field, next) => field.type === 'JSON' ? field.string('utf8') : next(),
    ssl: ssl ? {
      rejectUnauthorized: value('SSL_REJECT_UNAUTHORIZED') !== 'false',
      verifyIdentity: true,
      ...(ca ? { ca: ca.replace(/\\n/g, '\n') } : {})
    } : undefined
  }
}

const quote = name => '`' + String(name).replace(/`/g, '``') + '`'

function canonicalJson(value) {
  if (Array.isArray(value)) return '[' + value.map(canonicalJson).join(',') + ']'
  if (value && typeof value === 'object') {
    return '{' + Object.keys(value).sort().map(key => JSON.stringify(key) + ':' + canonicalJson(value[key])).join(',') + '}'
  }
  return JSON.stringify(value)
}

// Result fields carry the numeric protocol type (245 = JSON); typeCast gets the name.
const isJson = field => field.type === 'JSON' || field.type === 245 || field.columnType === 245

export function rowDigest(row, fields) {
  const parts = fields.map(field => {
    const value = row[field.name]
    if (value === null || value === undefined) return null
    if (Buffer.isBuffer(value)) return 'hex:' + value.toString('hex')
    if (isJson(field)) {
      try { return 'json:' + canonicalJson(JSON.parse(value)) } catch { return 'json:' + value }
    }
    return String(value)
  })
  return createHash('sha256').update(JSON.stringify([fields.map(field => field.name), parts])).digest('hex')
}

export async function tableDigest(connection, table) {
  const [rows, fields] = await connection.query('SELECT * FROM ' + quote(table))
  const digests = rows.map(row => rowDigest(row, fields)).sort()
  return { rows: rows.length, hash: createHash('sha256').update(digests.join('\n')).digest('hex') }
}

export async function baseTables(connection) {
  const [rows] = await connection.query(
    'SELECT TABLE_NAME AS name, TABLE_TYPE AS type FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE() ORDER BY TABLE_NAME'
  )
  const views = rows.filter(row => row.type !== 'BASE TABLE')
  if (views.length) throw new Error('A origem tem views, que esta cópia não cobre: ' + views.map(row => row.name).join(', '))
  return rows.map(row => row.name)
}

export function nextAutoIncrement(createSql) {
  const match = /\)\s*ENGINE=[^\n]*?\bAUTO_INCREMENT=(\d+)/i.exec(createSql) || /\bAUTO_INCREMENT=(\d+)\s/i.exec(createSql.slice(createSql.lastIndexOf(')')))
  return match ? Number(match[1]) : 0
}

// TiDB allocates ids in cached batches; AUTO_ID_CACHE=1 keeps them sequential
// like MySQL. The /*T! */ form is ignored by MySQL.
export function targetCreateSql(createSql, isTidb) {
  if (!isTidb || !/\bAUTO_INCREMENT\b/i.test(createSql.slice(0, createSql.lastIndexOf(')')))) return createSql
  return createSql + ' /*T![auto_id_cache] AUTO_ID_CACHE=1 */'
}

async function ensureDatabase(config) {
  const { database, ...server } = config
  const connection = await mysql.createConnection(server)
  try { await connection.query('CREATE DATABASE IF NOT EXISTS ' + quote(database) + ' DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci') }
  finally { await connection.end() }
}

// Aiven runs MySQL in ANSI mode, so SHOW CREATE TABLE would quote names with ".
// Dropping ANSI/ANSI_QUOTES for this session keeps the DDL in backticks.
export function withoutAnsiQuotes(mode) {
  return String(mode || '').split(',').map(item => item.trim()).filter(item => item && item !== 'ANSI' && item !== 'ANSI_QUOTES').join(',')
}

async function prepare(connection) {
  const [[{ mode }]] = await connection.query('SELECT @@SESSION.sql_mode AS mode')
  await connection.query('SET SESSION sql_mode=?', [withoutAnsiQuotes(mode)])
  await connection.query("SET SESSION time_zone='+00:00'")
  const [[version]] = await connection.query('SELECT VERSION() AS version')
  return /tidb/i.test(String(version.version))
}

export async function copyDatabase({ env = process.env, argv = process.argv.slice(2), log = console.log } = {}) {
  const opts = options(argv)
  const sourceConfig = connectionConfig(env, 'SOURCE_DB_')
  const targetConfig = connectionConfig(env, 'DB_')
  if (sourceConfig.host === targetConfig.host && sourceConfig.port === targetConfig.port && sourceConfig.database === targetConfig.database) {
    throw new Error('Origem e destino são o mesmo banco.')
  }
  if (!opts.verifyOnly) await ensureDatabase(targetConfig)
  const source = await mysql.createConnection(sourceConfig)
  const target = await mysql.createConnection(targetConfig)
  const summary = { tables: 0, rows: 0, differences: [] }
  try {
    await prepare(source)
    const targetIsTidb = await prepare(target)
    // One consistent snapshot of the source for the whole copy and check.
    await source.query('SET SESSION TRANSACTION ISOLATION LEVEL REPEATABLE READ')
    await source.query('START TRANSACTION WITH CONSISTENT SNAPSHOT, READ ONLY')
    const tables = await baseTables(source)

    if (!opts.verifyOnly) {
      const existing = await baseTables(target)
      if (existing.length && !opts.replace) throw new Error('O destino já tem ' + existing.length + ' tabelas. Use --replace para substituí-las.')
      await target.query('SET SESSION foreign_key_checks=0')
      await target.query("SET SESSION sql_mode=CONCAT(@@SESSION.sql_mode, ',NO_AUTO_VALUE_ON_ZERO')")
      for (const table of existing) await target.query('DROP TABLE ' + quote(table))
      for (const table of tables) {
        const [[created]] = await source.query('SHOW CREATE TABLE ' + quote(table))
        const createSql = created['Create Table']
        await target.query(targetCreateSql(createSql, targetIsTidb))
        const [rows, fields] = await source.query('SELECT * FROM ' + quote(table))
        const columns = fields.map(field => field.name)
        for (let start = 0; start < rows.length; start += 200) {
          const batch = rows.slice(start, start + 200).map(row => columns.map(column => row[column]))
          await target.query('INSERT INTO ' + quote(table) + ' (' + columns.map(quote).join(',') + ') VALUES ?', [batch])
        }
        const next = nextAutoIncrement(createSql)
        if (next > 1) await target.query('ALTER TABLE ' + quote(table) + ' AUTO_INCREMENT=' + next)
      }
      await target.query('SET SESSION foreign_key_checks=1')
    }

    const targetTables = await baseTables(target)
    const missing = tables.filter(table => !targetTables.includes(table))
    const extra = targetTables.filter(table => !tables.includes(table))
    for (const table of [...missing, ...extra]) summary.differences.push(table)
    for (const table of tables.filter(table => targetTables.includes(table))) {
      const [from, to] = await Promise.all([tableDigest(source, table), tableDigest(target, table)])
      const same = from.rows === to.rows && from.hash === to.hash
      if (!same) summary.differences.push(table)
      summary.tables++
      summary.rows += from.rows
      log(table + ': ' + from.rows + ' linhas ' + (same ? 'OK' : 'DIFERENTE (destino ' + to.rows + ')'))
    }
    if (missing.length) log('Faltam no destino: ' + missing.join(', '))
    if (extra.length) log('Só no destino: ' + extra.join(', '))
    await source.query('COMMIT')
  } finally {
    await Promise.allSettled([source.end(), target.end()])
  }
  const ok = summary.differences.length === 0
  const line = (ok ? 'COPIA_OK' : 'COPIA_DIFERENTE') + ' tabelas=' + summary.tables + ' linhas=' + summary.rows + (ok ? '' : ' diferentes=' + summary.differences.join(','))
  log(line)
  if (opts.summary) await writeFile(opts.summary, line + '\n')
  return { ok, ...summary }
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  copyDatabase().then(result => { process.exitCode = result.ok ? 0 : 1 }).catch(error => {
    console.error('Cópia interrompida:', error?.code || '', error?.message || error)
    process.exitCode = 1
  })
}
