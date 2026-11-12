import { companyAddress, normalizeCompanySettings } from './company.js'
import { LEGAL_PAGES, LEGAL_VERSION, LEGAL_VERSION_LABEL } from './pages.js'
import { whatsappNumber } from '../siteNavigation.js'

// Terms, policies and contact of the store, in plain Portuguese. The company
// data (Configurações → Dados da empresa) fills the texts; empty fields are left
// out. Text may hold **bold** and [links](/path). LEGAL_VERSION (pages.js)
// changes whenever the content changes: the accepted version is stored with the
// account and with each order.
export { LEGAL_PAGES, LEGAL_VERSION, LEGAL_VERSION_LABEL }

function formatPhone(number) {
  const local = number.replace(/^55/, '')
  return local.length === 11 ? `(${local.slice(0, 2)}) ${local.slice(2, 7)}-${local.slice(7)}` : `(${local.slice(0, 2)}) ${local.slice(2, 6)}-${local.slice(6)}`
}

// Company and contact data used by the texts.
export function legalContext({ company, footer } = {}) {
  const c = normalizeCompanySettings(company)
  const store = c.trade_name || (typeof footer?.brand === 'string' && footer.brand.trim()) || 'GALEO STORE'
  const whatsapp = whatsappNumber(footer?.whatsapp)
  const address = companyAddress(c)
  const channels = [c.email && `pelo e-mail ${c.email}`, whatsapp && `pelo WhatsApp ${formatPhone(whatsapp)}`].filter(Boolean)
  return {
    ...c,
    store,
    address,
    whatsapp,
    whatsappLabel: whatsapp ? formatPhone(whatsapp) : '',
    contact: channels.length ? channels.join(' ou ') : 'pelos canais da página [Contato](/contato)',
    seller: c.legal_name
      ? `A loja ${store} é operada por ${c.legal_name}${c.cnpj ? `, CNPJ ${c.cnpj}` : ''}${address ? `, com endereço em ${address}` : ''}.`
      : `A loja ${store} é operada pela empresa identificada na página [Contato](/contato).`
  }
}

function terms(x) {
  return {
    title: 'Termos de Uso e Condições de Compra',
    description: 'Regras para usar o site e comprar na ' + x.store + ': conta, preços, pagamento, entrega, trocas e atendimento.',
    summary: [
      'Ao criar sua conta ou finalizar uma compra, você aceita estes termos e a Política de Privacidade.',
      'O pedido só é confirmado depois que o Mercado Pago aprova o pagamento.',
      'Você pode desistir da compra em até 7 dias do recebimento, com reembolso total.',
      'Dúvidas e pedidos: ' + x.contact + '.'
    ],
    sections: [
      ['quem-somos', 'Quem somos', [x.seller, 'Atendimento: ' + x.contact + (x.hours ? `, ${x.hours}` : '') + '.']],
      ['aceite', 'Aceite e atualizações', [
        'Ao criar uma conta ou finalizar uma compra, você declara que leu e concorda com estes Termos e com a [Política de Privacidade](/privacidade). A versão aceita fica registrada com a data.',
        `Esta é a versão de ${LEGAL_VERSION_LABEL}. Podemos atualizar estes termos; a versão em vigor fica sempre nesta página. Uma mudança não altera pedidos já feitos.`
      ]],
      ['conta', 'Sua conta', [
        'Para comprar, é preciso ter 18 anos ou mais. Menores de idade devem comprar com um responsável.',
        'Use dados verdadeiros e mantenha sua senha em segredo. Você é responsável pelo que for feito com a sua conta.',
        'Contas usadas para fraude, ou com dados de outra pessoa, podem ser bloqueadas.'
      ]],
      ['produtos', 'Produtos, preços e estoque', [
        'As fotos mostram as peças da forma mais fiel possível. A cor pode variar um pouco conforme a tela. As medidas e os detalhes estão na descrição de cada produto.',
        'Os preços estão em reais (R$). O frete é calculado à parte e aparece antes do pagamento. Promoções valem pelo prazo informado ou enquanto houver estoque.',
        'Se um preço aparecer com um erro evidente (por exemplo, muito abaixo do valor real), avisamos você e cancelamos o pedido com reembolso total.'
      ]],
      ['pedido', 'Pedido e pagamento', [
        'Antes de finalizar, você vê o resumo do pedido: peças, tamanhos, quantidades, frete e total.',
        'O pagamento é feito pelo Mercado Pago, por Pix, cartão de crédito ou cartão de débito. Os dados do cartão são digitados nos campos seguros do Mercado Pago, e a loja não os recebe.',
        'O pedido só é confirmado depois que o pagamento é aprovado. Se o pagamento for recusado ou não for concluído, o pedido é cancelado e as peças voltam ao estoque.',
        'Você acompanha o pedido em [Minha conta](/conta). A nota fiscal é emitida em nome de quem fez o pedido.'
      ]],
      ['entrega', 'Entrega', ['O frete, o prazo, o rastreio e o que fazer em caso de atraso estão na página [Entregas](/entregas).']],
      ['cancelamento', 'Cancelamento, trocas e devoluções', [
        'Antes do envio, você pode pedir o cancelamento ' + x.contact + ', com reembolso total.',
        'Depois de receber, valem o direito de arrependimento de 7 dias, as trocas e a garantia contra defeitos, explicados em [Trocas e Devoluções](/trocas).'
      ]],
      ['marca', 'Marca e conteúdo', [
        'A marca GALEO, o logo, as fotos e os textos do site pertencem à loja e não podem ser copiados sem autorização. As marcas das outras grifes vendidas na loja pertencem aos seus donos.'
      ]],
      ['uso', 'Uso do site', [
        'Não é permitido usar o site para fraude, usar dados de outra pessoa, tentar invadir o sistema ou usar robôs para comprar ou copiar o conteúdo.',
        'Trabalhamos para manter o site no ar e seguro, mas ele pode ficar fora do ar por manutenção ou falha de serviços de terceiros. Isso não afeta os seus direitos de consumidor.'
      ]],
      ['atendimento', 'Atendimento e foro', [
        'Fale com a gente ' + x.contact + '. Você também pode registrar uma reclamação no [consumidor.gov.br](https://www.consumidor.gov.br) ou no Procon.',
        'Estes termos seguem o Código de Defesa do Consumidor (Lei 8.078/1990) e o Decreto 7.962/2013. Qualquer questão pode ser levada ao foro do seu domicílio.'
      ]]
    ]
  }
}

function privacy(x) {
  return {
    title: 'Política de Privacidade',
    description: 'Como a ' + x.store + ' trata seus dados pessoais, com quem compartilha e como você exerce seus direitos (LGPD).',
    summary: [
      'Usamos seus dados para criar sua conta, entregar seus pedidos e falar com você.',
      'Não vendemos seus dados e não usamos cookies de publicidade.',
      'Os dados do cartão ficam com o Mercado Pago, não com a loja.',
      'Para ver, corrigir ou apagar seus dados, fale com a gente ' + x.contact + '.'
    ],
    sections: [
      ['controlador', 'Quem cuida dos seus dados', [
        x.seller + ' Ela é a controladora dos seus dados pessoais, segundo a Lei Geral de Proteção de Dados (Lei 13.709/2018).',
        'Canal para assuntos de privacidade: ' + x.contact + '.'
      ]],
      ['dados', 'Quais dados coletamos', [
        '**Cadastro:** nome, e-mail, telefone e senha. A senha é guardada de forma cifrada (hash), e ninguém da loja consegue vê-la.',
        '**Pedidos:** endereço de entrega, CEP, peças compradas, valores e o andamento do pedido.',
        '**Pagamento:** o CPF e os dados do cartão são digitados nos campos seguros do Mercado Pago. A loja recebe só o resultado do pagamento, nunca o número do cartão. Na página de pagamento, o Mercado Pago usa um identificador do aparelho para prevenir fraudes.',
        '**Newsletter:** seu e-mail, só depois que você confirma a inscrição.',
        '**Navegação e segurança:** registros técnicos como endereço IP, data e hora, usados para proteger a loja contra fraudes e abusos.'
      ]],
      ['finalidades', 'Para que usamos', [
        '**Para cumprir o contrato de compra** (art. 7º, V): criar sua conta, processar pagamentos, entregar pedidos, fazer trocas e prestar atendimento.',
        '**Por obrigação legal** (art. 7º, II): emitir nota fiscal e guardar registros exigidos por lei.',
        '**Por legítimo interesse** (art. 7º, IX): segurança do site, prevenção a fraudes e melhoria da loja, sempre respeitando seus direitos.',
        '**Com o seu consentimento** (art. 7º, I): enviar a newsletter. Você pode cancelar quando quiser.'
      ]],
      ['compartilhamento', 'Com quem compartilhamos', [
        'Compartilhamos só o necessário com os serviços que fazem a loja funcionar:',
        '- **Mercado Pago:** pagamentos (Pix e cartões).',
        '- **Melhor Envio e transportadoras (como os Correios):** cálculo do frete e entrega; recebem nome, endereço, CEP e telefone.',
        '- **Resend:** envio dos e-mails da loja (confirmação de conta, pedidos e newsletter).',
        '- **BrasilAPI:** busca do endereço pelo CEP; recebe só o CEP.',
        '- **Netlify e Render:** hospedagem do site e do servidor. **Aiven:** banco de dados, com conexão protegida.',
        '- **Cloudinary:** fotos e vídeos dos produtos; não recebe dados de clientes.',
        '- **Google:** só quando você toca em "Avaliar no Google" e vai ao site do Google, que segue a política de privacidade dele.',
        'Também podemos fornecer dados a autoridades quando a lei exigir. Não vendemos seus dados.'
      ]],
      ['internacional', 'Dados fora do Brasil', [
        'Alguns desses serviços guardam dados em servidores fora do Brasil, com garantias de proteção previstas no art. 33 da LGPD.'
      ]],
      ['seguranca', 'Como protegemos', [
        'O site e a conexão com o banco de dados usam criptografia (HTTPS/TLS). As senhas são guardadas com hash. O acesso à área administrativa é restrito aos donos, com senha forte e registro das ações.',
        'Nenhum sistema é 100% seguro. Se houver um incidente que possa causar risco a você, avisaremos você e a ANPD, como manda a lei.'
      ]],
      ['retencao', 'Por quanto tempo guardamos', [
        '**Conta:** enquanto ela estiver ativa. Depois de um pedido de exclusão, apagamos ou anonimizamos os dados, exceto os que a lei manda guardar.',
        '**Pedidos e notas fiscais:** pelo menos 5 anos, por obrigações fiscais e do Código de Defesa do Consumidor.',
        '**Newsletter:** até você cancelar a inscrição.',
        '**Registros de segurança:** pelo tempo necessário para essa finalidade ou exigido por lei.'
      ]],
      ['direitos', 'Seus direitos', [
        'Pela LGPD (art. 18), você pode pedir: confirmação de que tratamos seus dados, acesso a eles, correção, anonimização ou exclusão de dados desnecessários, portabilidade, informação sobre com quem compartilhamos, e revogar o consentimento da newsletter.',
        'É só pedir ' + x.contact + '. Respondemos em até 15 dias. Você também pode reclamar na Autoridade Nacional de Proteção de Dados ([ANPD](https://www.gov.br/anpd)).'
      ]],
      ['cookies', 'Cookies e dados no seu aparelho', [
        '**Cookie de sessão:** mantém você conectado à sua conta e protege os formulários. É necessário para o site funcionar.',
        '**Dados no navegador:** o carrinho, o tema (claro ou escuro) e o Modo leve ficam guardados no seu aparelho. Você pode apagá-los limpando os dados do site no navegador.',
        'Não usamos cookies de publicidade nem de análise de visitas. Se isso mudar, esta política será atualizada e pediremos o seu consentimento.'
      ]],
      ['menores', 'Menores de idade', ['A loja é voltada para maiores de 18 anos. Não coletamos de propósito dados de crianças.']],
      ['atualizacoes', 'Atualizações', [`Esta é a versão de ${LEGAL_VERSION_LABEL}. Quando ela mudar, a nova versão fica nesta página com a data.`]]
    ]
  }
}

function exchanges(x) {
  return {
    title: 'Trocas, Devoluções e Arrependimento',
    description: 'Como desistir da compra em 7 dias, trocar tamanho ou modelo e o que fazer se a peça tiver defeito na ' + x.store + '.',
    summary: [
      'Desistiu? Você tem 7 dias do recebimento para devolver, com reembolso total, frete incluído.',
      'Trocas de tamanho ou modelo também em até 7 dias do recebimento, com a peça sem uso e com etiqueta.',
      'A 1ª troca de cada pedido tem o frete pago pela loja.',
      'Peça com defeito: avise em até 90 dias; o frete é por nossa conta.'
    ],
    sections: [
      ['arrependimento', 'Direito de arrependimento (7 dias)', [
        'Pelo art. 49 do Código de Defesa do Consumidor, você pode desistir da compra em até 7 dias corridos depois de receber o pedido, sem precisar explicar o motivo.',
        'O frete da devolução é por nossa conta, e o reembolso é total, incluindo o frete pago na compra.',
        'A peça deve voltar como você recebeu: sem sinais de uso além de provar, com as etiquetas e os acessórios.'
      ]],
      ['troca', 'Troca de tamanho ou modelo', [
        'Você pode trocar o tamanho ou o modelo em até 7 dias corridos depois de receber o pedido. A peça precisa estar sem uso, sem lavagem e com a etiqueta.',
        'A troca depende do estoque. Se não houver o que você quer, você pode escolher outra peça ou receber o valor de volta.',
        '**Frete da troca:** a primeira troca de cada pedido é por conta da loja, na ida e na volta. A partir da segunda troca do mesmo pedido, o frete é por conta do cliente.'
      ]],
      ['defeito', 'Peça com defeito', [
        'Se a peça tiver defeito, avise em até 90 dias do recebimento (art. 26 do CDC). O frete é por nossa conta.',
        'Temos até 30 dias para resolver (art. 18 do CDC). Se não for resolvido nesse prazo, você escolhe entre trocar por uma peça igual, receber o valor de volta ou ter um desconto proporcional.'
      ]],
      ['como-pedir', 'Como pedir', [
        'Fale com a gente ' + x.contact + ', com o número do pedido. Em caso de defeito, mande fotos da peça.',
        'Passamos as instruções e o código de postagem. Guarde o comprovante de envio.'
      ]],
      ['reembolso', 'Reembolso', [
        'Assim que a peça chega e é conferida, pedimos o reembolso ao Mercado Pago, pelo mesmo meio de pagamento da compra.',
        'No Pix, o valor volta para a conta que pagou. No cartão, o estorno aparece na fatura conforme o prazo do seu banco, em geral em até duas faturas.'
      ]]
    ]
  }
}

function shipping(x) {
  return {
    title: 'Entregas',
    description: 'Frete, prazos, rastreio e o que fazer em caso de atraso nas entregas da ' + x.store + '.',
    summary: [
      'Entregamos em todo o Brasil.',
      'O frete e o prazo aparecem no carrinho, pelo seu CEP, antes do pagamento.',
      'Quando o pedido é enviado, você recebe o código de rastreio.',
      'Atraso ou extravio é responsabilidade nossa: resolvemos com a transportadora.'
    ],
    sections: [
      ['frete', 'Frete e prazo', [
        'Calculamos o frete no carrinho pelo seu CEP, com as opções das transportadoras parceiras (via Melhor Envio, como os Correios). O valor e o prazo de cada opção aparecem antes do pagamento.',
        'O pedido é preparado e postado depois da confirmação do pagamento. O prazo da transportadora começa a contar na postagem.'
      ]],
      ['rastreio', 'Acompanhamento', [
        'Quando o pedido é enviado, avisamos você e passamos o código de rastreio. O andamento também aparece em [Minha conta](/conta).'
      ]],
      ['endereco', 'Endereço e recebimento', [
        'Confira o endereço antes de finalizar. Se a entrega voltar por endereço incorreto ou por ausência depois das tentativas da transportadora, combinamos com você um novo envio (com novo frete) ou o reembolso.'
      ]],
      ['problemas', 'Atraso, extravio ou avaria', [
        'Se a entrega atrasar, se perder ou chegar danificada, fale com a gente ' + x.contact + '. Resolvemos com a transportadora e enviamos de novo ou devolvemos o valor.',
        'Recebeu a embalagem violada? Se puder, recuse a entrega ou fotografe a embalagem antes de abrir.'
      ]]
    ]
  }
}

function contact(x) {
  const data = [
    x.legal_name && '**Razão social:** ' + x.legal_name,
    x.trade_name && '**Nome fantasia:** ' + x.trade_name,
    x.cnpj && '**CNPJ:** ' + x.cnpj,
    x.address && '**Endereço:** ' + x.address
  ].filter(Boolean)
  const channels = [
    x.email && `**E-mail:** [${x.email}](mailto:${x.email})`,
    x.whatsapp && `**WhatsApp:** [${x.whatsappLabel}](https://wa.me/${x.whatsapp})`,
    x.hours && '**Horário de atendimento:** ' + x.hours
  ].filter(Boolean)
  return {
    title: 'Contato',
    description: 'Fale com a ' + x.store + ': e-mail, WhatsApp, horário de atendimento e dados da empresa.',
    summary: null,
    sections: [
      ['atendimento', 'Atendimento', channels.length ? channels : ['Os canais de atendimento serão publicados em breve.']],
      ...(data.length ? [['empresa', 'Dados da empresa', data]] : []),
      ['politicas', 'Políticas da loja', ['- [Termos de Uso](/termos)', '- [Política de Privacidade](/privacidade)', '- [Trocas, Devoluções e Arrependimento](/trocas)', '- [Entregas](/entregas)']]
    ]
  }
}

const builders = { terms, privacy, exchanges, shipping, contact }

export function legalDocument(key, settings) {
  const build = builders[key]
  if (!build) return null
  const doc = build(legalContext(settings))
  return { ...doc, key, sections: doc.sections.map(([id, title, blocks]) => ({ id, title, blocks })) }
}

// Splits text into plain parts, **bold** parts and [links](url).
export function inlineParts(textValue) {
  const parts = []
  const pattern = /\*\*([^*]+)\*\*|\[([^\]]+)\]\(([^)\s]+)\)/g
  let last = 0
  for (const match of String(textValue).matchAll(pattern)) {
    if (match.index > last) parts.push({ type: 'text', text: textValue.slice(last, match.index) })
    parts.push(match[1] ? { type: 'bold', text: match[1] } : { type: 'link', text: match[2], href: match[3] })
    last = match.index + match[0].length
  }
  if (last < textValue.length) parts.push({ type: 'text', text: textValue.slice(last) })
  return parts
}
