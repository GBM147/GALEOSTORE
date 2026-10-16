import { AsyncLocalStorage } from 'node:async_hooks'

// Each Lambda invocation owns its work. Concurrent requests must never drain
// another request's tasks, or leave promises running after Lambda returns.
export function createBackgroundTasks({ onError = () => {} } = {}) {
  const context = new AsyncLocalStorage()
  const persistentTasks = new Set()
  const current = () => context.getStore() || persistentTasks
  function defer(promise) {
    const tasks = current()
    if (typeof promise === 'function') {
      if (!context.getStore()) return defer(Promise.resolve().then(promise))
      const start = () => { tasks.delete(start); return defer(Promise.resolve().then(promise)) }
      tasks.add(start)
      return
    }
    const task = Promise.resolve(promise).catch(error => { onError(error) })
    tasks.add(task)
    task.finally(() => tasks.delete(task))
    return task
  }
  async function drain() {
    const tasks = current()
    // A completing task can enqueue another task, for example an audit after
    // image processing. Drain until this invocation has no work left.
    while (tasks.size) await Promise.allSettled([...tasks].map(task => typeof task === 'function' ? task() : task))
  }
  return { defer, drain, run: work => context.run(new Set(), work) }
}
