import test from 'node:test'
import assert from 'node:assert/strict'
import { createBackgroundTasks } from './background-tasks.js'

test('each concurrent invocation drains only its own promises and nested work', async () => {
  const tasks = createBackgroundTasks()
  let release, finished = false
  const blocked = new Promise(resolve => { release = resolve })
  const first = tasks.run(async () => {
    tasks.defer(blocked.then(() => { tasks.defer(Promise.resolve().then(() => { finished = true })) }))
    await tasks.drain()
  })
  await tasks.run(async () => { tasks.defer(Promise.resolve()); await tasks.drain() })
  assert.equal(finished, false)
  release()
  await first
  assert.equal(finished, true)
})

test('deferred cleanup starts after the response work releases its transaction', async () => {
  const tasks = createBackgroundTasks()
  let transactionOpen = true, ran = false
  await tasks.run(async () => {
    tasks.defer(async () => { assert.equal(transactionOpen, false); ran = true })
    await Promise.resolve()
    assert.equal(ran, false)
    transactionOpen = false
    await tasks.drain()
  })
  assert.equal(ran, true)
})

test('a failed task is reported and does not discard remaining work', async () => {
  const errors = [], tasks = createBackgroundTasks({ onError: error => errors.push(error.message) })
  let finished = false
  await tasks.run(async () => {
    tasks.defer(Promise.reject(new Error('fixture')))
    tasks.defer(async () => { finished = true })
    await tasks.drain()
  })
  assert.deepEqual(errors, ['fixture'])
  assert.equal(finished, true)
})
