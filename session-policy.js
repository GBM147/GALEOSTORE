const DURACAO_SESSAO_PERSISTENTE_MS = 30 * 24 * 60 * 60 * 1000

function normalizarManterConectado(valor) {
  return valor === true || valor === 'true' || valor === 1 || valor === '1'
}

function configurarPersistenciaSessao(sessao, valor) {
  if (!sessao || !sessao.cookie) {
    throw new TypeError('Sessão inválida para configurar persistência.')
  }
  const manterConectado = normalizarManterConectado(valor)
  sessao.manterConectado = manterConectado
  sessao.cookie.maxAge = manterConectado ? DURACAO_SESSAO_PERSISTENTE_MS : null
  return manterConectado
}

function sessaoDevePersistir(sessao) {
  if (typeof sessao?.manterConectado === 'boolean') {
    return sessao.manterConectado
  }
  return Number.isFinite(sessao?.cookie?.maxAge) && sessao.cookie.maxAge > 0
}

export {
  DURACAO_SESSAO_PERSISTENTE_MS,
  configurarPersistenciaSessao,
  normalizarManterConectado,
  sessaoDevePersistir
}
