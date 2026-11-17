// MySQL 8.0 (source) -> TiDB (destination) copy with the store's real schema.
//   Source: loopback MySQL on COPY_SOURCE_PORT (3308), root / COPY_SOURCE_ROOT_PASSWORD
//   Destination: loopback TiDB on 3307, root / MYSQL_ROOT_PASSWORD
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import test from 'node:test'
import mysql from 'mysql2/promise'
import { copyDatabase } from '../scripts/copy-database.mjs'

const sourcePort = String(process.env.COPY_SOURCE_PORT || '3308')
const sourcePassword = process.env.COPY_SOURCE_ROOT_PASSWORD || ''
const targetPassword = process.env.MYSQL_ROOT_PASSWORD || ''
if (!sourcePassword || !targetPassword) throw new Error('Use os bancos locais descartáveis: COPY_SOURCE_ROOT_PASSWORD e MYSQL_ROOT_PASSWORD.')

const SOURCE_DB = 'galeo_copy_source'
const TARGET_DB = 'galeo_copy_target'
const server = (port, password) => ({ host: '127.0.0.1', port: Number(port), user: 'root', password })
const env = {
  SOURCE_DB_HOST: '127.0.0.1', SOURCE_DB_PORT: sourcePort, SOURCE_DB_USER: 'root', SOURCE_DB_PASSWORD: sourcePassword, SOURCE_DB_NAME: SOURCE_DB, SOURCE_DB_SSL: 'false',
  DB_HOST: '127.0.0.1', DB_PORT: '3307', DB_USER: 'root', DB_PASSWORD: targetPassword, DB_NAME: TARGET_DB, DB_SSL: 'false'
}
const quiet = () => {}

function migrate(port, password, database) {
  const result = spawnSync(process.execPath, ['scripts/migrate-schema.mjs'], {
    encoding: 'utf8',
    env: {
      ...process.env, NODE_ENV: 'test', DB_HOST: '127.0.0.1', DB_PORT: String(port), DB_USER: 'root', DB_PASSWORD: password,
      DB_NAME: database, DB_SSL: 'false', SESSION_SECRET: 'copy-test-session-secret-0123456789abcdef0123456789',
      ADMIN_EMAIL: 'dono@galeo.test', ADMIN_PASSWORD: 'senha-de-teste-123'
    }
  })
  assert.equal(result.status, 0, result.stderr || result.stdout)
}

let source, target
test.before(async () => {
  source = await mysql.createConnection(server(sourcePort, sourcePassword))
  target = await mysql.createConnection(server(3307, targetPassword))
  const [[version]] = await target.query('SELECT VERSION() AS v')
  assert.match(version.v, /TiDB/, 'o destino destes testes precisa ser o TiDB')
  await source.query('DROP DATABASE IF EXISTS ' + SOURCE_DB)
  await target.query('DROP DATABASE IF EXISTS ' + TARGET_DB)
  await source.query('CREATE DATABASE ' + SOURCE_DB + ' DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci')
  migrate(sourcePort, sourcePassword, SOURCE_DB)
  await source.query('USE ' + SOURCE_DB)
  await source.query(`CREATE TABLE copy_parent (
    id INT NOT NULL AUTO_INCREMENT PRIMARY KEY, name VARCHAR(80) NOT NULL
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`)
  await source.query(`CREATE TABLE copy_types (
    id INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
    parent_id INT NULL,
    price DECIMAL(10,2) NOT NULL,
    big BIGINT NULL,
    flag TINYINT(1) NOT NULL DEFAULT 0,
    status ENUM('A','B') NOT NULL DEFAULT 'A',
    happened DATETIME(3) NULL,
    stamped TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    day DATE NULL,
    content JSON NULL,
    note TEXT NULL,
    raw VARBINARY(16) NULL,
    CONSTRAINT fk_copy_parent FOREIGN KEY (parent_id) REFERENCES copy_parent(id) ON DELETE SET NULL
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`)
  await source.query("INSERT INTO copy_parent(id,name) VALUES (1000000020,'Camisetas')")
  await source.query(`INSERT INTO copy_types(id,parent_id,price,big,flag,status,happened,stamped,day,content,note,raw) VALUES
    (1000000020,1000000020,1234.50,9007199254740993,1,'B','2026-11-16 18:03:59.123','2026-11-16 18:03:59','2026-11-16','{"b":1,"a":[1,"ç"]}','Camiseta 👕 ação',UNHEX('00FF10')),
    (1000000021,NULL,0.00,NULL,0,'A',NULL,'2026-01-01 00:00:00',NULL,NULL,NULL,NULL)`)
  await source.query('ALTER TABLE copy_types AUTO_INCREMENT=1000000030')
})

test.after(async () => {
  await source?.query('DROP DATABASE IF EXISTS ' + SOURCE_DB).catch(() => {})
  await target?.query('DROP DATABASE IF EXISTS ' + TARGET_DB).catch(() => {})
  await Promise.allSettled([source?.end(), target?.end()])
})

test('copia o schema real da loja e os dados para o TiDB, conferindo linha por linha', async () => {
  const lines = []
  const result = await copyDatabase({ env, argv: [], log: line => lines.push(line) })
  assert.equal(result.ok, true, lines.join('\n'))
  const [tables] = await source.query("SELECT COUNT(*) AS n FROM information_schema.TABLES WHERE TABLE_SCHEMA=?", [SOURCE_DB])
  assert.equal(result.tables, Number(tables[0].n))
  assert.ok(result.tables > 20)
  assert.match(lines.at(-1), /^COPIA_OK tabelas=\d+ linhas=\d+$/)
  assert.ok(!lines.some(line => line.includes('ação') || line.includes('Camisetas')), 'a saída não mostra dados')

  await target.query('USE ' + TARGET_DB)
  const [[row]] = await target.query("SELECT price, big, flag, status, DATE_FORMAT(happened,'%Y-%m-%d %H:%i:%s.%f') AS happened, day, note, HEX(raw) AS raw, JSON_EXTRACT(content,'$.a[1]') AS c FROM copy_types WHERE id=1000000020")
  assert.equal(String(row.price), '1234.50')
  assert.equal(String(row.big), '9007199254740993')
  assert.equal(Number(row.flag), 1)
  assert.equal(row.status, 'B')
  assert.equal(row.happened, '2026-11-16 18:03:59.123000')
  assert.equal(row.note, 'Camiseta 👕 ação')
  assert.equal(row.raw, '00FF10')
  assert.equal(String(row.c), '"ç"')
  const [[owner]] = await target.query("SELECT COUNT(*) AS n FROM admin_users WHERE role='owner'")
  assert.equal(Number(owner.n), 1)
})

test('mantém a sequência de IDs e as chaves estrangeiras no destino', async () => {
  await target.query('USE ' + TARGET_DB)
  const [inserted] = await target.query("INSERT INTO copy_types(price) VALUES (1.00)")
  assert.equal(inserted.insertId, 1000000030)
  await assert.rejects(target.query('INSERT INTO copy_types(parent_id,price) VALUES (999,1.00)'), /foreign key/i)
  await target.query('DELETE FROM copy_types WHERE id=1000000030')
})

test('recusa destino com dados sem --replace e acusa diferença na conferência', async () => {
  await assert.rejects(copyDatabase({ env, argv: [], log: quiet }), /já tem \d+ tabelas/)
  await target.query('USE ' + TARGET_DB)
  await target.query("UPDATE copy_parent SET name='Alterado' WHERE id=1000000020")
  const verify = await copyDatabase({ env, argv: ['--verify-only'], log: quiet })
  assert.equal(verify.ok, false)
  assert.deepEqual(verify.differences, ['copy_parent'])
  const replaced = await copyDatabase({ env, argv: ['--replace'], log: quiet })
  assert.equal(replaced.ok, true)
})

test('as migrações da loja rodam no banco copiado sem mudar os dados', async () => {
  migrate(3307, targetPassword, TARGET_DB)
  const verify = await copyDatabase({ env, argv: ['--verify-only'], log: quiet })
  assert.equal(verify.ok, true, JSON.stringify(verify.differences))
})
