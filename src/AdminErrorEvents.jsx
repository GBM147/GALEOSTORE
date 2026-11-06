import { useCallback, useEffect, useState } from 'react'
import { adminApi as api } from './adminApi'

const dateTime = value => {
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? '—' : date.toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'medium' })
}

// Owners only: recent server errors (HTTP 5xx) with technical data, no customer data.
export default function AdminErrorEvents() {
  const [state, setState] = useState({ loading: true, error: '', events: [], retention: 30 })
  const load = useCallback(async () => {
    setState(current => ({ ...current, loading: true, error: '' }))
    try {
      const data = await api('/api/admin/error-events?limit=100')
      setState({ loading: false, error: '', events: Array.isArray(data?.events) ? data.events : [], retention: Number(data?.retention_days) || 30 })
    } catch (error) {
      setState(current => ({ ...current, loading: false, error: error?.message || 'Não foi possível carregar os erros.' }))
    }
  }, [])
  useEffect(() => { load() }, [load])
  return <section className="admin-panel admin-error-events" aria-labelledby="admin-error-events-title">
    <div className="admin-error-events-heading">
      <div>
        <h2 id="admin-error-events-title">Erros recentes</h2>
        <p>Falhas do servidor (erros 5xx) dos últimos {state.retention} dias, com até 2.000 registros. Só dados técnicos: nenhum dado de cliente é guardado.</p>
      </div>
      <button type="button" className="button button-ghost" onClick={load} disabled={state.loading}>{state.loading ? 'Atualizando…' : 'Atualizar'}</button>
    </div>
    {state.error && <p className="admin-error" role="alert">{state.error}</p>}
    {!state.loading && !state.error && !state.events.length && <p role="status">Nenhum erro registrado. Tudo certo por aqui.</p>}
    {state.events.length > 0 && <table>
      <thead><tr><th scope="col">Quando</th><th scope="col">Rota</th><th scope="col">Status</th><th scope="col">Código</th><th scope="col">Mensagem</th><th scope="col">Requisição</th></tr></thead>
      <tbody>{state.events.map(event => <tr key={event.id}>
        <td>{dateTime(event.created_at)}</td>
        <td><code>{event.method} {event.route}</code></td>
        <td>{event.status}</td>
        <td>{event.code || '—'}</td>
        <td>{event.context || '—'}</td>
        <td><small>{event.request_id || '—'}</small></td>
      </tr>)}</tbody>
    </table>}
  </section>
}
