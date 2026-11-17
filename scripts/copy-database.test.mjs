import assert from 'node:assert/strict'
import test from 'node:test'
import { connectionConfig, nextAutoIncrement, options, rowDigest, targetCreateSql } from './copy-database.mjs'

const env = { SOURCE_DB_HOST: 'src.example', SOURCE_DB_USER: 'u', SOURCE_DB_PASSWORD: 'p', SOURCE_DB_NAME: 'galeo' }

test('opções da cópia', () => {
  assert.deepEqual(options([]), { replace: false, verifyOnly: false, summary: '' })
  assert.deepEqual(options(['--replace', '--summary', 'r.txt']), { replace: true, verifyOnly: false, summary: 'r.txt' })
  assert.equal(options(['--verify-only']).verifyOnly, true)
  assert.throws(() => options(['--drop-all']), /Opção desconhecida/)
})

test('conexão segue as regras de TLS do servidor', () => {
  const config = connectionConfig(env, 'SOURCE_DB_')
  assert.equal(config.port, 3306)
  assert.deepEqual(config.ssl, { rejectUnauthorized: true, verifyIdentity: true })
  const custom = connectionConfig({ ...env, SOURCE_DB_PORT: '4000', SOURCE_DB_SSL_CA: 'a\\nb' }, 'SOURCE_DB_')
  assert.equal(custom.port, 4000)
  assert.equal(custom.ssl.ca, 'a\nb')
  assert.equal(connectionConfig({ ...env, SOURCE_DB_SSL: 'false' }, 'SOURCE_DB_').ssl, undefined)
  assert.throws(() => connectionConfig({ ...env, SOURCE_DB_PASSWORD: '' }, 'SOURCE_DB_'), /SOURCE_DB_PASSWORD/)
  assert.throws(() => connectionConfig(env, 'DB_'), /DB_HOST/)
})

const create = 'CREATE TABLE `products` (\n  `id` int NOT NULL AUTO_INCREMENT,\n  PRIMARY KEY (`id`)\n) ENGINE=InnoDB AUTO_INCREMENT=1000000022 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci'
const plain = 'CREATE TABLE `settings` (\n  `key` varchar(80) NOT NULL,\n  PRIMARY KEY (`key`)\n) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci'

test('próximo ID vem do SHOW CREATE TABLE', () => {
  assert.equal(nextAutoIncrement(create), 1000000022)
  assert.equal(nextAutoIncrement(plain), 0)
})

test('no TiDB, só tabelas com AUTO_INCREMENT ganham AUTO_ID_CACHE=1', () => {
  assert.match(targetCreateSql(create, true), /\/\*T!\[auto_id_cache\] AUTO_ID_CACHE=1 \*\/$/)
  assert.equal(targetCreateSql(create, false), create)
  assert.equal(targetCreateSql(plain, true), plain)
})

test('hash da linha ignora a ordem das chaves do JSON e distingue valores', () => {
  const fields = [{ name: 'id', type: 'LONG' }, { name: 'content', type: 'JSON' }, { name: 'blob', type: 'BLOB' }]
  const a = rowDigest({ id: '1', content: '{"b": 1, "a": [1, 2]}', blob: Buffer.from('x') }, fields)
  const b = rowDigest({ id: '1', content: '{"a":[1,2],"b":1}', blob: Buffer.from('x') }, fields)
  assert.equal(a, b)
  assert.notEqual(a, rowDigest({ id: '1', content: '{"a":[2,1],"b":1}', blob: Buffer.from('x') }, fields))
  assert.notEqual(a, rowDigest({ id: '1', content: '{"a":[1,2],"b":1}', blob: null }, fields))
  const protocol = [{ name: 'id', type: 3 }, { name: 'content', type: 245 }, { name: 'blob', type: 252 }]
  assert.equal(rowDigest({ id: '1', content: '{"b": 1, "a": [1, 2]}', blob: Buffer.from('x') }, protocol),
    rowDigest({ id: '1', content: '{"a":[1,2],"b":1}', blob: Buffer.from('x') }, protocol))
})
