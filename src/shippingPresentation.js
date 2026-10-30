const carrierLogos = Object.freeze({
  jadlog: '/images/carriers/jadlog.png',
  correios: '/images/carriers/correios.svg'
})

const jadlogServices = Object.freeze({
  '.package': 'Entrega econômica',
  package: 'Entrega econômica',
  '.com': 'Entrega expressa',
  com: 'Entrega expressa'
})

const text = value => typeof value === 'string' ? value.trim() : ''

// Presentation only: provider identifiers, signed quotes and prices stay intact.
export function shippingPresentation(input = {}) {
  const service = input && typeof input === 'object' && !Array.isArray(input) ? input : {}
  const carrier = text(service.company)
  const carrierKey = carrier.toLocaleLowerCase('pt-BR')
  const rawName = text(service.name) || text(service.service_name)
  const normalizedName = rawName.toLocaleLowerCase('pt-BR').replace(/^jadlog\s*[-—]?\s*/, '')
  const serviceId = String(service.service_id ?? service.id ?? '')
  let serviceName = rawName

  if (carrierKey === 'jadlog') {
    serviceName = jadlogServices[normalizedName] || rawName
    if (!serviceName) serviceName = ({ 3: 'Entrega econômica', 4: 'Entrega expressa' })[serviceId] || ''
  }

  const label = [carrier, serviceName].filter(Boolean).join(' — ') || 'Entrega'
  return { carrier, serviceName, label, logoSrc: carrierLogos[carrierKey] || null }
}
