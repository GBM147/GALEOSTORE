import { CheckIcon } from './icons'
import './checkout-steps.css'

const steps = ['Carrinho', 'Pagamento', 'Confirmação']

// Where the buyer is in the purchase: cart, then payment, then confirmation.
export default function CheckoutSteps({ current }) {
  return (
    <ol className="checkout-steps" aria-label="Etapas da compra">
      {steps.map((label, index) => {
        const step = index + 1, done = step < current, active = step === current
        return (
          <li key={label} className={done ? 'is-done' : active ? 'is-current' : undefined} aria-current={active ? 'step' : undefined}>
            <span className="checkout-step-mark" aria-hidden="true">{done ? <CheckIcon /> : step}</span>
            <span className="checkout-step-label">{label}{done && <span className="checkout-step-status"> (concluída)</span>}</span>
          </li>
        )
      })}
    </ol>
  )
}
