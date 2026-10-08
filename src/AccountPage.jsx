import { useEffect, useRef, useState } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { customerApi } from './storeApi'

const dateTime = (value) => value ? new Date(value).toLocaleString('pt-BR', { dateStyle:'short', timeStyle:'short' }) : '—'
const money = (value) => Number(value || 0).toLocaleString('pt-BR', { style:'currency', currency:'BRL' })
const verificationTokenFromHash = (hash) => /^#verify=([a-f0-9]{64})$/i.exec(hash)?.[1] || ''

export default function AccountPage() {
  const location = useLocation()
  const navigate = useNavigate()
  const returnTo = new URLSearchParams(location.search).get('return') || '/'
  const verificationLink = useRef(location.hash.startsWith('#verify='))
  const [user, setUser] = useState(null)
  const [orders, setOrders] = useState([])
  const [mode, setMode] = useState(verificationLink.current ? 'verify' : 'login')
  const [verificationToken, setVerificationToken] = useState(() => verificationTokenFromHash(location.hash))
  const [verificationPassword, setVerificationPassword] = useState('')
  const [verificationEmail, setVerificationEmail] = useState('')
  const [resendPassword, setResendPassword] = useState('')
  const [resendCooldown, setResendCooldown] = useState(0)
  const [loginForm, setLoginForm] = useState({ email:'', password:'' })
  const [registerForm, setRegisterForm] = useState({ name:'', email:'', phone:'', password:'', passwordConfirm:'' })
  const [profile, setProfile] = useState({ name:'', phone:'' })
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')

  function clearPasswords() {
    setLoginForm((form) => ({ ...form, password:'' }))
    setRegisterForm((form) => ({ ...form, password:'', passwordConfirm:'' }))
    setVerificationPassword('')
    setResendPassword('')
  }

  function chooseMode(nextMode) {
    clearPasswords(); setError(''); setSuccess(''); setVerificationToken('')
    verificationLink.current = false
    setMode(nextMode)
  }

  function showVerification(email, message) {
    setUser(null); setOrders([]); clearPasswords(); setVerificationToken('')
    setVerificationEmail(email || '')
    setLoginForm((form) => ({ ...form, email:email || form.email, password:'' }))
    setMode('pending'); setError('')
    setSuccess(message || 'Confirme seu e-mail pelo link enviado antes de entrar na conta.')
  }

  useEffect(() => {
    if (!location.hash.startsWith('#verify=')) return
    const token = verificationTokenFromHash(location.hash)
    verificationLink.current = true
    window.history.replaceState(window.history.state, '', window.location.pathname + window.location.search)
    setUser(null); setOrders([]); clearPasswords(); setSuccess(''); setMode('verify')
    setVerificationToken(token)
    setError(token ? '' : 'Este link de confirmação é inválido. Solicite um novo e-mail.')
  }, [location.hash])

  useEffect(() => {
    if (!resendCooldown) return
    const timer = window.setTimeout(() => setResendCooldown((seconds) => Math.max(0, seconds - 1)), 1000)
    return () => window.clearTimeout(timer)
  }, [resendCooldown])

  async function loadMe() {
    if (verificationLink.current) return
    try {
      const data = await customerApi('/api/customer/me')
      if (verificationLink.current) return
      if (!data?.authenticated || !data.user) { setUser(null); setOrders([]); return }
      setUser(data.user)
      setProfile({ name:data.user.name || '', phone:data.user.phone || '' })
      const orderData = await customerApi('/api/customer/orders')
      setOrders(Array.isArray(orderData?.orders) ? orderData.orders : [])
    } catch (err) {
      if (verificationLink.current) return
      if (err.code === 'EMAIL_VERIFICATION_REQUIRED') showVerification(err.data?.email, err.message)
      else if (err.status === 401) { setUser(null); setOrders([]) }
      else setError(err.message)
    }
  }

  useEffect(() => { loadMe().finally(() => setLoading(false)) }, [])

  async function login(event) {
    event.preventDefault(); setSaving(true); setError(''); setSuccess('')
    try {
      const data = await customerApi('/api/customer/login',{ method:'POST', body:loginForm })
      setUser(data.user); setProfile({ name:data.user.name || '', phone:data.user.phone || '' })
      clearPasswords()
      const orderData = await customerApi('/api/customer/orders')
      setOrders(orderData.orders || [])
      navigate(returnTo)
    } catch (err) {
      if (err.code === 'EMAIL_VERIFICATION_REQUIRED') showVerification(err.data?.email || loginForm.email, err.message)
      else {
        if (err.status === 401) { setUser(null); setOrders([]) }
        setError(err.message)
      }
    } finally { setSaving(false) }
  }

  async function register(event) {
    event.preventDefault(); setSaving(true); setError(''); setSuccess('')
    if (registerForm.password !== registerForm.passwordConfirm) { setError('As senhas não coincidem'); setSaving(false); return }
    try {
      const data = await customerApi('/api/customer/register',{ method:'POST', body:registerForm })
      if (!data?.verification_required) throw new Error('Não foi possível iniciar a confirmação do e-mail. Tente novamente.')
      showVerification(registerForm.email, data.message)
      setResendCooldown(60)
    } catch (err) { setError(err.message) } finally { setSaving(false) }
  }

  async function resendVerification(event) {
    event.preventDefault()
    if (resendCooldown || saving) return
    setSaving(true); setError(''); setSuccess('')
    try {
      const data = await customerApi('/api/customer/resend-verification', { method:'POST', body:{ email:verificationEmail, password:resendPassword } })
      setSuccess(data?.message || 'Se a conta ainda precisar de confirmação, enviaremos um novo link. Confira também a pasta de spam.')
      setResendCooldown(60)
    } catch (err) {
      setError(err.message)
      if (err.retryAfter) setResendCooldown(Math.ceil(err.retryAfter))
    } finally { setResendPassword(''); setSaving(false) }
  }

  async function verifyEmail(event) {
    event.preventDefault()
    if (!verificationToken || saving) return
    setSaving(true); setError(''); setSuccess('')
    try {
      await customerApi('/api/customer/verify-email', { method:'POST', body:{ token:verificationToken, password:verificationPassword } })
      chooseMode('login')
      setSuccess('E-mail confirmado. Entre com sua senha para acessar a conta.')
    } catch (err) {
      setError(err.message)
    } finally { setVerificationPassword(''); setSaving(false) }
  }

  async function saveProfile(event) {
    event.preventDefault(); setSaving(true); setError(''); setSuccess('')
    try {
      const data = await customerApi('/api/customer/profile',{ method:'PUT', body:profile })
      setUser(data.user); setSuccess('Dados atualizados')
    } catch (err) {
      if (err.code === 'EMAIL_VERIFICATION_REQUIRED') showVerification(err.data?.email || user?.email, err.message)
      else if (err.status === 401) { chooseMode('login'); setUser(null); setOrders([]); setError('Sua sessão terminou. Entre novamente.') }
      else setError(err.message)
    } finally { setSaving(false) }
  }

  async function logout() {
    try { await customerApi('/api/customer/logout',{ method:'POST' }) } catch {}
    setUser(null); setOrders([]); chooseMode('login'); navigate('/')
  }

  if (loading) return <main className="section-shell page-space product-page-state"><span className="eyebrow">GALEO / CONTA</span><h1>Carregando conta</h1></main>

  if (!user) {
    return (
      <main className="section-shell account-page page-space">
        <div className="page-heading"><span className="eyebrow">GALEO / CONTA</span><h1>{mode === 'login' ? 'Entre na sua conta' : mode === 'register' ? 'Crie sua conta' : 'Confirme seu e-mail'}</h1><p>{mode === 'verify' ? 'Digite sua senha para confirmar que este e-mail é seu' : mode === 'pending' ? 'Abra o link enviado para seu e-mail antes de acessar a conta' : 'Guarde seus dados e acompanhe seus pedidos em um só lugar'}</p></div>
        <div className="account-auth">
          <div className="account-auth-tabs"><button className={mode==='login'?'active':''} type="button" disabled={saving} onClick={() => chooseMode('login')}>Entrar</button><button className={mode==='register'?'active':''} type="button" disabled={saving} onClick={() => chooseMode('register')}>Criar conta</button></div>
          {mode === 'login' ? (
            <form className="account-form" onSubmit={login}>
              <label>E-mail<input type="email" autoComplete="email" value={loginForm.email} onChange={(e) => setLoginForm({...loginForm,email:e.target.value})} required /></label>
              <label>Senha<input type="password" autoComplete="current-password" value={loginForm.password} onChange={(e) => setLoginForm({...loginForm,password:e.target.value})} required /></label>
              {error && <p className="form-error">{error}</p>}
              {success && <p className="form-success" role="status">{success}</p>}
              <button className="button button-primary" disabled={saving}>{saving ? 'Entrando…' : 'Entrar ↗'}</button>
              <Link className="text-link" to="/">Continuar navegando ↗</Link>
            </form>
          ) : mode === 'register' ? (
            <form className="account-form" onSubmit={register}>
              <label>Nome<input autoComplete="name" value={registerForm.name} onChange={(e) => setRegisterForm({...registerForm,name:e.target.value})} required /></label>
              <label>E-mail<input type="email" autoComplete="email" value={registerForm.email} onChange={(e) => setRegisterForm({...registerForm,email:e.target.value})} required /></label>
              <label>Telefone<input autoComplete="tel" value={registerForm.phone} onChange={(e) => setRegisterForm({...registerForm,phone:e.target.value})} /></label>
              <label>Senha<input type="password" autoComplete="new-password" minLength="10" value={registerForm.password} onChange={(e) => setRegisterForm({...registerForm,password:e.target.value})} required /></label>
              <label>Confirmar senha<input type="password" autoComplete="new-password" minLength="10" value={registerForm.passwordConfirm} onChange={(e) => setRegisterForm({...registerForm,passwordConfirm:e.target.value})} required /></label>
              <p>Você receberá um link para confirmar seu e-mail. A conta será liberada após a confirmação.</p>
              {error && <p className="form-error">{error}</p>}
              <button className="button button-primary" disabled={saving}>{saving ? 'Criando…' : 'Criar conta ↗'}</button>
            </form>
          ) : mode === 'verify' ? (
            <form className="account-form" onSubmit={verifyEmail}>
              <label>Senha<input type="password" autoComplete="current-password" value={verificationPassword} onChange={(e) => setVerificationPassword(e.target.value)} required disabled={!verificationToken} /></label>
              {error && <p className="form-error" role="alert">{error}</p>}
              <button className="button button-primary" disabled={saving || !verificationToken}>{saving ? 'Confirmando…' : 'Confirmar e-mail ↗'}</button>
              <button className="text-button" type="button" disabled={saving} onClick={() => { chooseMode('pending'); setSuccess('Informe o e-mail e a senha da sua conta para solicitar um novo link.') }}>Solicitar novo e-mail</button>
            </form>
          ) : (
            <form className="account-form" onSubmit={resendVerification}>
              {success && <p className="form-success" role="status">{success}</p>}
              <p>Confira sua caixa de entrada e a pasta de spam. Se precisar de outro link, confirme abaixo os dados da conta.</p>
              <label>E-mail<input type="email" autoComplete="email" value={verificationEmail} onChange={(e) => setVerificationEmail(e.target.value)} required /></label>
              <label>Senha<input type="password" autoComplete="current-password" value={resendPassword} onChange={(e) => setResendPassword(e.target.value)} required /></label>
              {error && <p className="form-error" role="alert">{error}</p>}
              <button className="button button-primary" disabled={saving || resendCooldown > 0}>{saving ? 'Enviando…' : resendCooldown > 0 ? `Reenviar em ${resendCooldown}s` : 'Reenviar e-mail ↗'}</button>
              <Link className="text-link" to="/">Continuar navegando ↗</Link>
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
