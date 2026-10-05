import { useEffect, useState } from 'react'

const api = async (path, options = {}) => {
  const headers = new Headers(options.headers || {})
  if (options.body && typeof options.body !== 'string') {
    headers.set('Content-Type', 'application/json')
    options = { ...options, body: JSON.stringify(options.body) }
  }

  const response = await fetch(path, {
    ...options,
    headers,
    credentials: 'include'
  })

  const raw = await response.text()
  let data = null
  try { data = raw ? JSON.parse(raw) : null } catch {}

  if (!response.ok) {
    throw new Error(data?.error || 'Erro na comunicação com o servidor.')
  }
  return data
}

const money = (v) => Number(v || 0).toLocaleString('pt-BR', {
  style: 'currency',
  currency: 'BRL'
})

function Login({ onLogin }) {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [manterConectado, setManterConectado] = useState(false)
  const [error, setError] = useState('')

  async function submit(event) {
    event.preventDefault()
    setError('')
    try {
      const data = await api('/api/auth/login', {
        method: 'POST',
        body: { email, password, manterConectado }
      })
      if (!data?.success) throw new Error('Não foi possível iniciar a sessão.')
      onLogin(data.user)
    } catch (err) {
      setError(err?.message || 'Não foi possível entrar no painel.')
    }
  }

  return (
    <main className="admin-login">
      <form onSubmit={submit}>
        <span className="eyebrow">GALEO / ADMIN</span>
        <h1>Painel administrativo.</h1>
        <input placeholder="E-mail" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
        <input placeholder="Senha" type="password" value={password} onChange={(e) => setPassword(e.target.value)} required />
        <label className="admin-check">
          <input type="checkbox" checked={manterConectado} onChange={(e) => setManterConectado(e.target.checked)} />
          Manter conectado
        </label>
        <button className="button button-primary">Entrar ↗</button>
        {error && <p className="admin-error">{error}</p>}
      </form>
    </main>
  )
}

function Admin({ user, onLogout }) {
  const [tab, setTab] = useState('dashboard')
  const [dash, setDash] = useState(null)
  const [products, setProducts] = useState([])
  const [entries, setEntries] = useState([])
  const [categories, setCategories] = useState([])
  const [recurring, setRecurring] = useState([])
  const [loading, setLoading] = useState(true)
  const [modal, setModal] = useState(null)

  const load = async () => {
    setLoading(true)
    try {
      const [d, p, e, c, r] = await Promise.all([
        api('/api/admin/dashboard'),
        api('/api/admin/products'),
        api('/api/admin/finance/entries'),
        api('/api/admin/finance/categories'),
        api('/api/admin/finance/recurring')
      ])
      setDash(d)
      setProducts(p)
      setEntries(e)
      setCategories(c)
      setRecurring(r)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    load().catch((error) => {
      if (error.message.includes('Sessão') || error.message.includes('conta')) {
        onLogout()
      } else {
        alert(error.message)
      }
    })
  }, [])

  async function stock(product, type) {
    const qty = prompt(type === 'ENTRADA' ? 'Quantidade que entrou:' : 'Quantidade que saiu:')
    if (!qty) return
    try {
      await api('/api/admin/stock', {
        method: 'POST',
        body: {
          product_id: product.id,
          type,
          quantity: Number(qty),
          reason: type === 'ENTRADA' ? 'Entrada de mercadoria' : 'Saída manual'
        }
      })
      await load()
    } catch (error) {
      alert(error.message)
    }
  }

  async function pay(id) {
    try {
      await api('/api/admin/finance/entries/' + id + '/pay', { method: 'PATCH' })
      await load()
    } catch (error) {
      alert(error.message)
    }
  }

  async function logout() {
    try { await api('/api/auth/logout', { method: 'POST' }) } catch {}
    onLogout()
  }

  return (
    <div className="admin-shell">
      <aside className="admin-side">
        <div className="brand"><span className="brand-mark">G</span><span>GALEO</span></div>
        {[
          ['dashboard', 'Visão geral'],
          ['products', 'Produtos e estoque'],
          ['finance', 'Financeiro'],
          ['recurring', 'Contas recorrentes']
        ].map(([key, label]) => (
          <button className={tab === key ? 'admin-nav active' : 'admin-nav'} onClick={() => setTab(key)} key={key}>
            {label}
          </button>
        ))}
        <div className="admin-user">
          <strong>{user?.email}</strong>
          <small>{user?.role}</small>
        </div>
        <button className="admin-nav logout" onClick={logout}>Sair</button>
      </aside>

      <main className="admin-main">
        <div className="admin-top">
          <div>
            <span className="eyebrow">ADMIN / {String(user?.id || '').padStart(3, '0')}</span>
            <h1>
              {tab === 'dashboard'
                ? 'Visão geral'
                : tab === 'products'
                  ? 'Produtos e estoque'
                  : tab === 'finance'
                    ? 'Financeiro'
                    : 'Contas recorrentes'}
            </h1>
          </div>
          <button
            className="button button-primary"
            onClick={() => setModal(tab === 'products' ? 'stock' : tab === 'finance' ? 'expense' : 'recurring')}
          >
            {tab === 'products' ? '+ Movimentar estoque' : tab === 'finance' ? '+ Registrar lançamento' : '+ Nova recorrência'}
          </button>
        </div>

        {loading ? <p>Carregando...</p> : null}

        {!loading && tab === 'dashboard' && (
          <>
            <div className="metric-grid">
              {[
                ['Produtos', dash.products.count],
                ['Estoque', dash.products.stock + ' un.'],
                ['Entradas no mês', '+' + dash.stock.entradas],
                ['Saídas no mês', '-' + dash.stock.saidas],
                ['Receitas pagas', money(dash.income)],
                ['Despesas pagas', money(dash.expense)],
                ['A pagar', money(dash.payable)],
                ['A receber', money(dash.receivable)]
              ].map(([label, value]) => (
                <div className="metric" key={label}><span>{label}</span><strong>{value}</strong></div>
              ))}
            </div>
            <div className="admin-panel">
              <h2>Alertas</h2>
              <p>{dash.products.low_stock} produto(s) no estoque mínimo ou abaixo.</p>
            </div>
          </>
        )}

        {!loading && tab === 'products' && (
          <div className="admin-panel">
            <table>
              <thead><tr><th>Produto</th><th>Preço</th><th>Custo</th><th>Estoque</th><th></th></tr></thead>
              <tbody>
                {products.map((product) => (
                  <tr key={product.id}>
                    <td><strong>{product.name}</strong><small>{product.category || 'Sem categoria'}</small></td>
                    <td>{money(product.price)}</td>
                    <td>{money(product.cost)}</td>
                    <td><strong>{product.stock}</strong>{product.stock <= product.min_stock && <small className="warn"> estoque baixo</small>}</td>
                    <td>
                      <button onClick={() => stock(product, 'ENTRADA')}>+ entrada</button>{' '}
                      <button onClick={() => stock(product, 'SAIDA')}>− saída</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {!loading && tab === 'finance' && (
          <div className="admin-panel">
            <table>
              <thead><tr><th>Descrição</th><th>Categoria</th><th>Vencimento</th><th>Valor</th><th>Status</th><th></th></tr></thead>
              <tbody>
                {entries.map((entry) => (
                  <tr key={entry.id}>
                    <td>{entry.description}</td>
                    <td>{entry.category || '—'}</td>
                    <td>{entry.due_date || '—'}</td>
                    <td>{money(entry.amount)}</td>
                    <td>{entry.status}</td>
                    <td>{entry.status === 'PENDENTE' && <button onClick={() => pay(entry.id)}>Marcar pago</button>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {!loading && tab === 'recurring' && (
          <div className="admin-panel">
            <table>
              <thead><tr><th>Despesa</th><th>Categoria</th><th>Valor</th><th>Dia</th></tr></thead>
              <tbody>
                {recurring.map((item) => (
                  <tr key={item.id}>
                    <td>{item.description}</td>
                    <td>{item.category || '—'}</td>
                    <td>{money(item.amount)}</td>
                    <td>{item.due_day}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </main>

      {modal && (
        <Modal
          type={modal}
          categories={categories}
          products={products}
          onClose={() => setModal(null)}
          onDone={() => { setModal(null); load() }}
        />
      )}
    </div>
  )
}

function Modal({ type, categories, products, onClose, onDone }) {
  const [form, setForm] = useState({ type: 'DESPESA', status: 'PENDENTE', due_day: 10 })
  const set = (key, value) => setForm((current) => ({ ...current, [key]: value }))

  async function submit(event) {
    event.preventDefault()
    try {
      if (type === 'stock') {
        await api('/api/admin/stock', {
          method: 'POST',
          body: {
            ...form,
            quantity: Number(form.quantity),
            product_id: Number(form.product_id)
          }
        })
      }

      if (type === 'expense') {
        await api('/api/admin/finance/entries', {
          method: 'POST',
          body: { ...form, amount: Number(form.amount), type: 'DESPESA' }
        })
      }

      if (type === 'recurring') {
        await api('/api/admin/finance/recurring', {
          method: 'POST',
          body: { ...form, amount: Number(form.amount), due_day: Number(form.due_day) }
        })
      }

      onDone()
    } catch (error) {
      alert(error.message)
    }
  }

  return (
    <div className="modal-backdrop">
      <form className="admin-modal" onSubmit={submit}>
        <button type="button" className="modal-close" onClick={onClose}>×</button>
        <span className="eyebrow">NOVO LANÇAMENTO</span>
        <h2>{type === 'stock' ? 'Movimentar estoque' : type === 'expense' ? 'Registrar gasto' : 'Despesa recorrente'}</h2>

        {type === 'stock' ? (
          <>
            <select value={form.product_id || ''} onChange={(e) => set('product_id', e.target.value)} required>
              <option value="">Produto</option>
              {products.map((product) => <option value={product.id} key={product.id}>{product.name} — estoque {product.stock}</option>)}
            </select>
            <select value={form.type || 'ENTRADA'} onChange={(e) => set('type', e.target.value)}>
              <option value="ENTRADA">ENTRADA</option>
              <option value="SAIDA">SAIDA</option>
            </select>
            <input type="number" min="1" placeholder="Quantidade" onChange={(e) => set('quantity', e.target.value)} required />
            <input placeholder="Motivo" onChange={(e) => set('reason', e.target.value)} />
          </>
        ) : (
          <>
            <input placeholder="Descrição" onChange={(e) => set('description', e.target.value)} required />
            <select onChange={(e) => set('category_id', e.target.value)} required>
              <option value="">Categoria</option>
              {categories.filter((category) => category.type === 'DESPESA').map((category) => (
                <option value={category.id} key={category.id}>{category.name}</option>
              ))}
            </select>
            <input type="number" step="0.01" placeholder="Valor" onChange={(e) => set('amount', e.target.value)} required />
            <input type="date" onChange={(e) => set('due_date', e.target.value)} />
            {type === 'expense'
              ? <select onChange={(e) => set('status', e.target.value)}><option>PENDENTE</option><option>PAGO</option></select>
              : <input type="number" min="1" max="31" placeholder="Dia do vencimento" onChange={(e) => set('due_day', e.target.value)} />}
          </>
        )}

        <button className="button button-primary">Salvar</button>
      </form>
    </div>
  )
}

export default function AdminGate() {
  const [user, setUser] = useState(null)
  const [checking, setChecking] = useState(true)

  useEffect(() => {
    api('/api/auth/me')
      .then((data) => setUser(data.user))
      .catch(() => {})
      .finally(() => setChecking(false))
  }, [])

  if (checking) return <main className="admin-login"><p>Verificando sessão...</p></main>
  return user
    ? <Admin user={user} onLogout={() => setUser(null)} />
    : <Login onLogin={setUser} />
}
