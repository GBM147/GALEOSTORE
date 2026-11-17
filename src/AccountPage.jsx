import { useEffect, useRef, useState } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { customerApi } from './storeApi'
import { usePageMeta } from './pageMeta'
import './account.css'

const dateTime = (value) => value ? new Date(value).toLocaleString('pt-BR', { dateStyle:'short', timeStyle:'short' }) : '—'
const money = (value) => Number(value || 0).toLocaleString('pt-BR', { style:'currency', currency:'BRL' })
const paymentLabels = { PENDING:'Aguardando pagamento', APPROVED:'Aprovado', REJECTED:'Recusado', CANCELLED:'Cancelado', REFUNDED:'Estornado' }
const verificationTokenFromHash = (hash) => /^#verify=([a-f0-9]{64})$/i.exec(hash)?.[1] || ''
const resetTokenFromHash = (hash) => /^#redefinir=(\d{1,12}\.\d{10}\.[A-Za-z0-9_-]{43})$/.exec(hash)?.[1] || ''
// E-mail links open the page with #verify= (confirm e-mail) or #redefinir= (new password).
const linkMode = (hash) => hash.startsWith('#verify=') ? 'verify' : hash.startsWith('#redefinir=') ? 'reset' : ''
const authTitles = { login:'Entre na sua conta', register:'Crie sua conta', forgot:'Recuperar senha', reset:'Crie uma nova senha' }
const authSubtitles = {
  verify:'Digite sua senha para confirmar que este e-mail é seu',
  pending:'Abra o link enviado para seu e-mail antes de acessar a conta',
  forgot:'Enviaremos um link para o e-mail da sua conta',
  reset:'Escolha uma senha nova para entrar na sua conta'
}
const emptyPasswordForm = { current:'', next:'', confirm:'' }
const closedDeleteForm = { open:false, password:'', confirm:false }

export default function AccountPage() {
  usePageMeta('Minha conta')
  const location = useLocation()
  const navigate = useNavigate()
  const returnTo = new URLSearchParams(location.search).get('return') || '/'
  const verificationLink = useRef(Boolean(linkMode(location.hash)))
  const [user, setUser] = useState(null)
  const [orders, setOrders] = useState([])
  const [mode, setMode] = useState(() => linkMode(location.hash) || 'login')
  const [verificationToken, setVerificationToken] = useState(() => verificationTokenFromHash(location.hash))
  const [resetToken, setResetToken] = useState(() => resetTokenFromHash(location.hash))
  const [resetForm, setResetForm] = useState({ password:'', passwordConfirm:'' })
  const [forgotEmail, setForgotEmail] = useState('')
  const [passwordForm, setPasswordForm] = useState(emptyPasswordForm)
  const [passwordStatus, setPasswordStatus] = useState({ error:'', success:'' })
  const [deleteForm, setDeleteForm] = useState(closedDeleteForm)
  const [deleteError, setDeleteError] = useState('')
  const [verificationPassword, setVerificationPassword] = useState('')
  const [verificationEmail, setVerificationEmail] = useState('')
  const [resendPassword, setResendPassword] = useState('')
  const [resendCooldown, setResendCooldown] = useState(0)
  const [loginForm, setLoginForm] = useState({ email:'', password:'' })
  const [registerForm, setRegisterForm] = useState({ name:'', email:'', phone:'', password:'', passwordConfirm:'' })
  const [acceptTerms, setAcceptTerms] = useState(false)
  const [profile, setProfile] = useState({ name:'', phone:'' })
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const [registrationStatus, setRegistrationStatus] = useState('checking')
  const [registrationCheck, setRegistrationCheck] = useState(0)

  function clearPasswords() {
    setLoginForm((form) => ({ ...form, password:'' }))
    setRegisterForm((form) => ({ ...form, password:'', passwordConfirm:'' }))
    setVerificationPassword('')
    setResendPassword('')
    setResetForm({ password:'', passwordConfirm:'' })
    setPasswordForm(emptyPasswordForm)
    setDeleteForm(closedDeleteForm)
  }

  function chooseMode(nextMode) {
    clearPasswords(); setError(''); setSuccess(''); setVerificationToken(''); setResetToken('')
    setPasswordStatus({ error:'', success:'' }); setDeleteError('')
    if (nextMode === 'register') {
      setRegistrationStatus('checking')
      setRegistrationCheck((attempt) => attempt + 1)
    }
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
    const flow = linkMode(location.hash)
    if (!flow) return
    const token = flow === 'verify' ? verificationTokenFromHash(location.hash) : resetTokenFromHash(location.hash)
    verificationLink.current = true
    // The token leaves the address bar (and the browser history) right away.
    window.history.replaceState(window.history.state, '', window.location.pathname + window.location.search)
    setUser(null); setOrders([]); clearPasswords(); setSuccess(''); setMode(flow)
    if (flow === 'verify') {
      setVerificationToken(token)
      setError(token ? '' : 'Este link de confirmação é inválido. Solicite um novo e-mail.')
    } else {
      setResetToken(token)
      setError(token ? '' : 'Este link para criar uma nova senha é inválido. Peça um novo link.')
    }
  }, [location.hash])

  useEffect(() => {
    if (!resendCooldown) return
    const timer = window.setTimeout(() => setResendCooldown((seconds) => Math.max(0, seconds - 1)), 1000)
    return () => window.clearTimeout(timer)
  }, [resendCooldown])

  useEffect(() => {
    if (mode !== 'register') return
    let active = true
    setRegistrationStatus('checking')
    customerApi('/api/customer/registration-status')
      .then((data) => { if (active) setRegistrationStatus(data?.registration_available === true ? 'available' : 'unavailable') })
      .catch(() => { if (active) setRegistrationStatus('error') })
    return () => { active = false }
  }, [mode, registrationCheck])

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
      else if (err.status === 401) { setUser(null); setOrders([]); if (err.code === 'SESSION_PASSWORD_CHANGED') setError(err.message) }
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
    event.preventDefault()
    if (registrationStatus !== 'available' || saving) return
    setSaving(true); setError(''); setSuccess('')
    if (registerForm.password !== registerForm.passwordConfirm) { setError('As senhas não coincidem'); setSaving(false); return }
    if (!acceptTerms) { setError('Para criar a conta, aceite os Termos de Uso e a Política de Privacidade.'); setSaving(false); return }
    try {
      const data = await customerApi('/api/customer/register',{ method:'POST', body:{ ...registerForm, accept_terms:true } })
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

  async function requestReset(event) {
    event.preventDefault()
    if (resendCooldown || saving) return
    setSaving(true); setError(''); setSuccess('')
    try {
      const data = await customerApi('/api/customer/password-reset', { method:'POST', body:{ email:forgotEmail } })
      setSuccess(data?.message || 'Se houver uma conta com este e-mail, enviamos um link para criar uma nova senha. Confira também a pasta de spam.')
      setResendCooldown(60)
    } catch (err) {
      setError(err.message)
      if (err.retryAfter) setResendCooldown(Math.ceil(err.retryAfter))
    } finally { setSaving(false) }
  }

  async function confirmReset(event) {
    event.preventDefault()
    if (!resetToken || saving) return
    if (resetForm.password !== resetForm.passwordConfirm) { setError('As senhas não coincidem'); return }
    setSaving(true); setError(''); setSuccess('')
    try {
      const data = await customerApi('/api/customer/password-reset/confirm', { method:'POST', body:{ token:resetToken, password:resetForm.password } })
      chooseMode('login')
      setSuccess(data?.message || 'Nova senha criada. Entre com ela para acessar a conta.')
    } catch (err) {
      setError(err.message)
      if (err.code === 'RESET_LINK_INVALID') setResetToken('')
    } finally { setResetForm({ password:'', passwordConfirm:'' }); setSaving(false) }
  }

  function endSession(message = 'Sua sessão terminou. Entre novamente.') {
    chooseMode('login'); setUser(null); setOrders([]); setError(message)
  }

  async function changePassword(event) {
    event.preventDefault()
    if (saving) return
    if (passwordForm.next !== passwordForm.confirm) { setPasswordStatus({ error:'As senhas novas não coincidem', success:'' }); return }
    setSaving(true); setPasswordStatus({ error:'', success:'' })
    try {
      const data = await customerApi('/api/customer/password', { method:'PUT', body:{ currentPassword:passwordForm.current, newPassword:passwordForm.next } })
      setPasswordStatus({ error:'', success:data?.message || 'Senha alterada.' })
    } catch (err) {
      if (err.code === 'EMAIL_VERIFICATION_REQUIRED') showVerification(err.data?.email || user?.email, err.message)
      else if (err.status === 401) endSession(err.code === 'SESSION_PASSWORD_CHANGED' ? err.message : undefined)
      else setPasswordStatus({ error:err.message, success:'' })
    } finally { setPasswordForm(emptyPasswordForm); setSaving(false) }
  }

  async function deleteAccount(event) {
    event.preventDefault()
    if (saving) return
    if (!deleteForm.confirm) { setDeleteError('Marque a confirmação para excluir a conta.'); return }
    setSaving(true); setDeleteError('')
    try {
      const data = await customerApi('/api/customer/account', { method:'DELETE', body:{ password:deleteForm.password, confirm:true } })
      chooseMode('login'); setUser(null); setOrders([])
      setLoginForm({ email:'', password:'' })
      setSuccess(data?.message || 'Sua conta foi excluída.')
    } catch (err) {
      if (err.code === 'EMAIL_VERIFICATION_REQUIRED') showVerification(err.data?.email || user?.email, err.message)
      else if (err.status === 401) endSession(err.code === 'SESSION_PASSWORD_CHANGED' ? err.message : undefined)
      else { setDeleteError(err.message); setDeleteForm((form) => ({ ...form, password:'' })) }
    } finally { setSaving(false) }
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

  if (loading) return <main className="section-shell page-space product-page-state"><h1>Carregando conta</h1></main>

  if (!user) {
    return (
      <main className="section-shell account-page page-space">
        <div className="page-heading account-auth-heading"><span className="section-eyebrow">Minha conta</span><h1>{authTitles[mode] || 'Confirme seu e-mail'}</h1><p>{authSubtitles[mode] || 'Guarde seus dados e acompanhe seus pedidos em um só lugar'}</p></div>
        <div className="account-auth">
          <div className="account-auth-tabs"><button className={mode==='login'?'active':''} type="button" aria-pressed={mode==='login'} disabled={saving} onClick={() => chooseMode('login')}>Entrar</button><button className={mode==='register'?'active':''} type="button" aria-pressed={mode==='register'} disabled={saving} onClick={() => chooseMode('register')}>Criar conta</button></div>
          {mode === 'login' ? (
            <form className="account-form" onSubmit={login}>
              <label>E-mail<input type="email" autoComplete="email" value={loginForm.email} onChange={(e) => setLoginForm({...loginForm,email:e.target.value})} required /></label>
              <label>Senha<input type="password" autoComplete="current-password" value={loginForm.password} onChange={(e) => setLoginForm({...loginForm,password:e.target.value})} required /></label>
              <button className="text-button account-forgot" type="button" disabled={saving} onClick={() => { const email = loginForm.email; chooseMode('forgot'); setForgotEmail(email) }}>Esqueci minha senha</button>
              {error && <p className="form-error">{error}</p>}
              {success && <p className="form-success" role="status">{success}</p>}
              <button className="button button-primary" disabled={saving}>{saving ? 'Entrando…' : 'Entrar ↗'}</button>
              <Link className="text-link" to="/">Continuar navegando ↗</Link>
            </form>
          ) : mode === 'forgot' ? (
            <form className="account-form" onSubmit={requestReset}>
              <p>Informe o e-mail da sua conta. Se ele estiver cadastrado, você recebe um link para criar uma nova senha.</p>
              <label>E-mail<input type="email" autoComplete="email" value={forgotEmail} onChange={(e) => setForgotEmail(e.target.value)} required /></label>
              {error && <p className="form-error" role="alert">{error}</p>}
              {success && <p className="form-success" role="status">{success}</p>}
              <button className="button button-primary" disabled={saving || resendCooldown > 0}>{saving ? 'Enviando…' : resendCooldown > 0 ? `Enviar de novo em ${resendCooldown}s` : 'Enviar link ↗'}</button>
              <button className="text-button" type="button" disabled={saving} onClick={() => chooseMode('login')}>Voltar para Entrar</button>
            </form>
          ) : mode === 'reset' ? (
            <form className="account-form" onSubmit={confirmReset}>
              {resetToken && <>
                <label>Nova senha<input type="password" autoComplete="new-password" minLength="10" maxLength="72" value={resetForm.password} onChange={(e) => setResetForm({...resetForm,password:e.target.value})} required /></label>
                <label>Confirmar nova senha<input type="password" autoComplete="new-password" minLength="10" maxLength="72" value={resetForm.passwordConfirm} onChange={(e) => setResetForm({...resetForm,passwordConfirm:e.target.value})} required /></label>
                <p className="account-hint">Use pelo menos 10 caracteres.</p>
              </>}
              {error && <p className="form-error" role="alert">{error}</p>}
              {resetToken
                ? <button className="button button-primary" disabled={saving}>{saving ? 'Salvando…' : 'Salvar nova senha ↗'}</button>
                : <button className="button button-primary" type="button" onClick={() => chooseMode('forgot')}>Pedir novo link ↗</button>}
            </form>
          ) : mode === 'register' && registrationStatus !== 'available' ? (
            <div className="account-form">
              {registrationStatus === 'checking'
                ? <p role="status">Verificando disponibilidade do cadastro…</p>
                : <><p className={registrationStatus === 'error' ? 'form-error' : undefined} role={registrationStatus === 'error' ? 'alert' : 'status'}>{registrationStatus === 'error' ? 'Não foi possível verificar a disponibilidade do cadastro. Tente novamente.' : 'O cadastro está temporariamente indisponível. Tente novamente mais tarde.'}</p><p>Se já tem uma conta, use Entrar.</p><button className="button button-primary" type="button" onClick={() => { setRegistrationStatus('checking'); setRegistrationCheck((attempt) => attempt + 1) }}>Verificar novamente</button></>}
            </div>
          ) : mode === 'register' ? (
            <form className="account-form" onSubmit={register}>
              <label>Nome<input autoComplete="name" value={registerForm.name} onChange={(e) => setRegisterForm({...registerForm,name:e.target.value})} required /></label>
              <label>E-mail<input type="email" autoComplete="email" value={registerForm.email} onChange={(e) => setRegisterForm({...registerForm,email:e.target.value})} required /></label>
              <label>Telefone<input autoComplete="tel" value={registerForm.phone} onChange={(e) => setRegisterForm({...registerForm,phone:e.target.value})} /></label>
              <label>Senha<input type="password" autoComplete="new-password" minLength="10" value={registerForm.password} onChange={(e) => setRegisterForm({...registerForm,password:e.target.value})} required /></label>
              <label>Confirmar senha<input type="password" autoComplete="new-password" minLength="10" value={registerForm.passwordConfirm} onChange={(e) => setRegisterForm({...registerForm,passwordConfirm:e.target.value})} required /></label>
              <label className="terms-accept"><input type="checkbox" checked={acceptTerms} onChange={(e) => setAcceptTerms(e.target.checked)} required /><span>Li e aceito os <Link to="/termos" target="_blank" rel="noopener noreferrer">Termos de Uso</Link> e a <Link to="/privacidade" target="_blank" rel="noopener noreferrer">Política de Privacidade</Link>.</span></label>
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
      <div className="page-heading account-heading">
        <div><span className="section-eyebrow">Minha conta</span><h1>{user.name}</h1><p>{user.email}</p></div>
        <button className="account-logout" type="button" onClick={logout}>Sair da conta</button>
      </div>
      <div className="account-layout">
        <section className="account-orders-card" aria-labelledby="account-orders-title">
          <div className="account-card-heading"><h2 id="account-orders-title">Meus pedidos</h2>{orders.length > 0 && <span>{orders.length === 1 ? '1 pedido' : orders.length + ' pedidos'}</span>}</div>
          {!orders.length ? <div className="empty-catalog"><h3>Nenhum pedido ainda</h3><p>Quando você fizer um pedido, ele aparecerá aqui</p><Link className="text-link" to="/shop">Explorar catálogo ↗</Link></div> : <div className="account-orders-list">{orders.map((order) => (
            <article className="account-order" key={order.id}>
              <div className="account-order-head">
                <div className="account-order-id"><strong>{order.code}</strong><span>{dateTime(order.created_at)}</span></div>
                <span className="account-order-status">{order.status_label || order.status}</span>
                <strong className="account-order-total">{money(order.total)}</strong>
              </div>
              <p className="account-order-items">{(order.items || []).map((item) => item.name + (item.size_label ? ' — tamanho ' + item.size_label : '') + ' × ' + item.quantity).join(' · ')}</p>
              <div className="account-order-foot">
                <span className="account-payment" data-status={order.payment_status || 'UNKNOWN'}>Pagamento: {paymentLabels[order.payment_status] || 'Aguardando confirmação'}</span>
                {order.payment_available && <Link className="button button-primary account-pay" to={'/pagamento/' + order.id} reloadDocument>Continuar pagamento</Link>}
              </div>
            </article>
          ))}</div>}
        </section>
        <div className="account-side">
        <section className="account-profile-card" aria-labelledby="account-profile-title">
          <div className="account-card-heading"><h2 id="account-profile-title">Perfil</h2></div>
          <form className="account-form" onSubmit={saveProfile}>
            <label>Nome<input value={profile.name} onChange={(e) => setProfile({...profile,name:e.target.value})} required /></label>
            <label>Telefone<input value={profile.phone} onChange={(e) => setProfile({...profile,phone:e.target.value})} /></label>
            {error && <p className="form-error">{error}</p>}
            {success && <p className="form-success">{success}</p>}
            <button className="button button-primary" disabled={saving}>{saving ? 'Salvando…' : 'Salvar dados ↗'}</button>
          </form>
        </section>
        <section className="account-side-card" aria-labelledby="account-password-title">
          <div className="account-card-heading"><h2 id="account-password-title">Alterar senha</h2></div>
          <form className="account-form" onSubmit={changePassword}>
            <label>Senha atual<input type="password" autoComplete="current-password" value={passwordForm.current} onChange={(e) => setPasswordForm({...passwordForm,current:e.target.value})} required /></label>
            <label>Nova senha<input type="password" autoComplete="new-password" minLength="10" maxLength="72" value={passwordForm.next} onChange={(e) => setPasswordForm({...passwordForm,next:e.target.value})} required /></label>
            <label>Confirmar nova senha<input type="password" autoComplete="new-password" minLength="10" maxLength="72" value={passwordForm.confirm} onChange={(e) => setPasswordForm({...passwordForm,confirm:e.target.value})} required /></label>
            {passwordStatus.error && <p className="form-error" role="alert">{passwordStatus.error}</p>}
            {passwordStatus.success && <p className="form-success" role="status">{passwordStatus.success}</p>}
            <button className="button button-primary" disabled={saving}>{saving ? 'Salvando…' : 'Alterar senha ↗'}</button>
          </form>
        </section>
        <section className="account-side-card account-delete-card" aria-labelledby="account-delete-title">
          <div className="account-card-heading"><h2 id="account-delete-title">Excluir conta</h2></div>
          <p>Apagamos seu nome, e-mail e telefone do cadastro, cancelamos a newsletter e encerramos o acesso. Os pedidos já feitos ficam guardados pelo prazo exigido por lei, como explica a <Link to="/privacidade">Política de Privacidade</Link>. Não dá para desfazer.</p>
          <p>Com um pedido pago ainda em andamento, a exclusão fica liberada depois da entrega ou do cancelamento.</p>
          {!deleteForm.open ? (
            <button className="button account-delete-open" type="button" disabled={saving} onClick={() => { setDeleteError(''); setDeleteForm({ ...closedDeleteForm, open:true }) }}>Excluir minha conta</button>
          ) : (
            <form className="account-form" onSubmit={deleteAccount}>
              <label>Sua senha<input type="password" autoComplete="current-password" value={deleteForm.password} onChange={(e) => setDeleteForm({...deleteForm,password:e.target.value})} required /></label>
              <label className="terms-accept"><input type="checkbox" checked={deleteForm.confirm} onChange={(e) => setDeleteForm({...deleteForm,confirm:e.target.checked})} required /><span>Entendo que a exclusão é definitiva.</span></label>
              {deleteError && <p className="form-error" role="alert">{deleteError}</p>}
              <button className="button account-delete-button" disabled={saving}>{saving ? 'Excluindo…' : 'Excluir definitivamente'}</button>
              <button className="text-button" type="button" disabled={saving} onClick={() => { setDeleteError(''); setDeleteForm(closedDeleteForm) }}>Cancelar</button>
            </form>
          )}
        </section>
        </div>
      </div>
    </main>
  )
}
