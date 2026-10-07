import { useEffect, useState } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { customerApi } from './storeApi'

const dateTime = (value) => value ? new Date(value).toLocaleString('pt-BR', { dateStyle:'short', timeStyle:'short' }) : '—'
const money = (value) => Number(value || 0).toLocaleString('pt-BR', { style:'currency', currency:'BRL' })

export default function AccountPage() {
  const location = useLocation()
  const navigate = useNavigate()
  const returnTo = new URLSearchParams(location.search).get('return') || '/'
  const [user, setUser] = useState(null)
  const [orders, setOrders] = useState([])
  const [mode, setMode] = useState('login')
  const [loginForm, setLoginForm] = useState({ email:'', password:'' })
  const [registerForm, setRegisterForm] = useState({ name:'', email:'', phone:'', password:'', passwordConfirm:'' })
  const [profile, setProfile] = useState({ name:'', phone:'' })
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')

  async function loadMe() {
    try {
      const data = await customerApi('/api/customer/me')
      if (!data.authenticated) return
      setUser(data.user)
      setProfile({ name:data.user.name || '', phone:data.user.phone || '' })
      const orderData = await customerApi('/api/customer/orders')
      setOrders(Array.isArray(orderData?.orders) ? orderData.orders : [])
    } catch {}
  }

  useEffect(() => { loadMe().finally(() => setLoading(false)) }, [])

  async function login(event) {
    event.preventDefault(); setSaving(true); setError(''); setSuccess('')
    try {
      const data = await customerApi('/api/customer/login',{ method:'POST', body:loginForm })
      setUser(data.user); setProfile({ name:data.user.name || '', phone:data.user.phone || '' })
      const orderData = await customerApi('/api/customer/orders')
      setOrders(orderData.orders || [])
      navigate(returnTo)
    } catch (err) { setError(err.message) } finally { setSaving(false) }
  }

  async function register(event) {
    event.preventDefault(); setSaving(true); setError('')
    if (registerForm.password !== registerForm.passwordConfirm) { setError('As senhas não coincidem'); setSaving(false); return }
    try {
      const data = await customerApi('/api/customer/register',{ method:'POST', body:registerForm })
      setUser(data.user); setProfile({ name:data.user.name || '', phone:data.user.phone || '' }); setOrders([])
      navigate(returnTo)
    } catch (err) { setError(err.message) } finally { setSaving(false) }
  }

  async function saveProfile(event) {
    event.preventDefault(); setSaving(true); setError(''); setSuccess('')
    try {
      const data = await customerApi('/api/customer/profile',{ method:'PUT', body:profile })
      setUser(data.user); setSuccess('Dados atualizados')
    } catch (err) { setError(err.message) } finally { setSaving(false) }
  }

  async function logout() {
    try { await customerApi('/api/customer/logout',{ method:'POST' }) } catch {}
    setUser(null); setOrders([]); navigate('/')
  }

  if (loading) return <main className="section-shell page-space product-page-state"><span className="eyebrow">GALEO / CONTA</span><h1>Carregando conta</h1></main>

  if (!user) {
    return (
      <main className="section-shell account-page page-space">
        <div className="page-heading"><span className="eyebrow">GALEO / CONTA</span><h1>{mode === 'login' ? 'Entre na sua conta' : 'Crie sua conta'}</h1><p>Guarde seus dados e acompanhe seus pedidos em um só lugar</p></div>
        <div className="account-auth">
          <div className="account-auth-tabs"><button className={mode==='login'?'active':''} type="button" onClick={() => { setMode('login'); setError('') }}>Entrar</button><button className={mode==='register'?'active':''} type="button" onClick={() => { setMode('register'); setError('') }}>Criar conta</button></div>
          {mode === 'login' ? (
            <form className="account-form" onSubmit={login}>
              <label>E-mail<input type="email" autoComplete="email" value={loginForm.email} onChange={(e) => setLoginForm({...loginForm,email:e.target.value})} required /></label>
              <label>Senha<input type="password" autoComplete="current-password" value={loginForm.password} onChange={(e) => setLoginForm({...loginForm,password:e.target.value})} required /></label>
              {error && <p className="form-error">{error}</p>}
              <button className="button button-primary" disabled={saving}>{saving ? 'Entrando…' : 'Entrar ↗'}</button>
              <Link className="text-link" to="/">Continuar navegando ↗</Link>
            </form>
          ) : (
            <form className="account-form" onSubmit={register}>
              <label>Nome<input autoComplete="name" value={registerForm.name} onChange={(e) => setRegisterForm({...registerForm,name:e.target.value})} required /></label>
              <label>E-mail<input type="email" autoComplete="email" value={registerForm.email} onChange={(e) => setRegisterForm({...registerForm,email:e.target.value})} required /></label>
              <label>Telefone<input autoComplete="tel" value={registerForm.phone} onChange={(e) => setRegisterForm({...registerForm,phone:e.target.value})} /></label>
              <label>Senha<input type="password" autoComplete="new-password" minLength="10" value={registerForm.password} onChange={(e) => setRegisterForm({...registerForm,password:e.target.value})} required /></label>
              <label>Confirmar senha<input type="password" autoComplete="new-password" minLength="10" value={registerForm.passwordConfirm} onChange={(e) => setRegisterForm({...registerForm,passwordConfirm:e.target.value})} required /></label>
              {error && <p className="form-error">{error}</p>}
              <button className="button button-primary" disabled={saving}>{saving ? 'Criando…' : 'Criar conta ↗'}</button>
            </form>
          )}
        </div>
      </main>
    )
  }

  return (
    <main className="section-shell account-page page-space">
      <div className="page-heading"><span className="eyebrow">GALEO / MINHA CONTA</span><h1>{user.name}</h1><p>{user.email}</p></div>
      <div className="account-layout">
        <section className="account-profile-card">
          <div className="account-card-heading"><span className="eyebrow">MEUS DADOS</span><h2>Perfil</h2></div>
          <form className="account-form" onSubmit={saveProfile}>
            <label>Nome<input value={profile.name} onChange={(e) => setProfile({...profile,name:e.target.value})} required /></label>
            <label>Telefone<input value={profile.phone} onChange={(e) => setProfile({...profile,phone:e.target.value})} /></label>
            {error && <p className="form-error">{error}</p>}
            {success && <p className="form-success">{success}</p>}
            <button className="button button-primary" disabled={saving}>{saving ? 'Salvando…' : 'Salvar dados ↗'}</button>
            <button className="text-button" type="button" onClick={logout}>Sair da conta</button>
          </form>
        </section>
        <section className="account-orders-card">
          <div className="account-card-heading"><span className="eyebrow">HISTÓRICO</span><h2>Meus pedidos</h2></div>
          {!orders.length ? <div className="empty-catalog"><h2>Nenhum pedido ainda</h2><p>Quando você fizer um pedido, ele aparecerá aqui</p><Link className="text-link" to="/shop">Explorar catálogo ↗</Link></div> : <div className="account-orders-list">{orders.map((order) => <article className="account-order" key={order.id}><div><span>{order.code}</span><strong>{dateTime(order.created_at)}</strong></div><div><span>{order.status_label || order.status}</span><strong>{money(order.total)}</strong></div><small>{(order.items || []).map((item) => item.name + ' × ' + item.quantity).join(' · ')}</small></article>)}</div>}
        </section>
      </div>
    </main>
  )
}
