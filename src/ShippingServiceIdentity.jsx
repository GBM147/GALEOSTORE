import { useState } from 'react'
import { shippingPresentation } from './shippingPresentation'

export function ShippingProviderAttribution() {
  const [showLogo, setShowLogo] = useState(true)
  return <p className="shipping-provider-attribution">
    {showLogo && <span className="shipping-provider-logo" aria-hidden="true"><img src="/images/carriers/melhor-envio.svg" alt="" width="52" height="24" decoding="async" onError={() => setShowLogo(false)} /></span>}
    <span>Cotação pelo <strong>Melhor Envio</strong></span>
  </p>
}

export default function ShippingServiceIdentity({ service, children, className = '' }) {
  const presentation = shippingPresentation(service)
  const [failedLogo, setFailedLogo] = useState(null)
  const showLogo = presentation.logoSrc && failedLogo !== presentation.logoSrc

  return <span className={['shipping-service-identity', className].filter(Boolean).join(' ')}>
    {showLogo && <span className="shipping-service-logo" aria-hidden="true">
      <img src={presentation.logoSrc} alt="" width="92" height="24" decoding="async" onError={() => setFailedLogo(presentation.logoSrc)} />
    </span>}
    <span className="shipping-service-copy"><strong>{presentation.label}</strong>{children}</span>
  </span>
}
