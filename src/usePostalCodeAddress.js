import { useEffect, useRef, useState } from 'react'
import { customerApi } from './storeApi'

const addressFields = ['street', 'neighborhood', 'city', 'state']
const emptyRevisions = () => Object.fromEntries(addressFields.map(field => [field, 0]))
const digits = value => String(value || '').replace(/\D/g, '')
const postalInput = value => {
  const valueDigits = digits(value).slice(0, 8)
  return valueDigits.length > 5 ? valueDigits.slice(0, 5) + '-' + valueDigits.slice(5) : valueDigits
}

function addressFromResponse(data, postalCode) {
  if (!data || typeof data !== 'object' || Array.isArray(data) || digits(data.postal_code) !== postalCode) return null
  if (!addressFields.every(field => typeof data[field] === 'string')) return null
  const address = Object.fromEntries(addressFields.map(field => [field, data[field].trim().slice(0, 200)]))
  address.state = address.state.toUpperCase()
  if (!address.city || !/^[A-Z]{2}$/.test(address.state)) return null
  return address
}

// A lookup fills only the address attached to its current CEP. Manual edits
// made after that CEP was entered always take precedence over a late response.
export default function usePostalCodeAddress(form, setForm) {
  const postalCode = digits(form.postal_code)
  const currentPostalCode = useRef(postalCode)
  currentPostalCode.current = postalCode
  const manualRevisions = useRef(emptyRevisions())
  const automaticValues = useRef({})
  const lookupCycle = useRef(null)
  const request = useRef(0)
  const activeController = useRef(null)
  const [lookup, setLookup] = useState({ status: 'idle', postalCode: '' })

  function changePostalCode(value) {
    const formatted = postalInput(value)
    const nextPostalCode = digits(formatted)
    if (nextPostalCode === currentPostalCode.current) {
      setForm(current => ({ ...current, postal_code: formatted }))
      return
    }
    request.current += 1
    activeController.current?.abort()
    currentPostalCode.current = nextPostalCode
    lookupCycle.current = { postalCode: nextPostalCode, revisions: { ...manualRevisions.current } }
    const previousAutomatic = { ...automaticValues.current }
    automaticValues.current = {}
    setLookup({ status: 'idle', postalCode: nextPostalCode })
    setForm(current => {
      const next = { ...current, postal_code: formatted }
      for (const field of addressFields) {
        if (Object.hasOwn(previousAutomatic, field) && current[field] === previousAutomatic[field]) next[field] = ''
      }
      return next
    })
  }

  function changeAddressField(field, value) {
    if (!addressFields.includes(field)) return
    manualRevisions.current[field] += 1
    delete automaticValues.current[field]
    setForm(current => ({ ...current, [field]: value }))
  }

  useEffect(() => {
    if (!/^\d{8}$/.test(postalCode)) return
    const id = ++request.current
    const controller = new AbortController()
    activeController.current = controller
    const revisions = lookupCycle.current?.postalCode === postalCode
      ? { ...lookupCycle.current.revisions }
      : { ...manualRevisions.current }
    setLookup({ status: 'loading', postalCode })
    const current = () => id === request.current && !controller.signal.aborted && currentPostalCode.current === postalCode
    const timer = window.setTimeout(async () => {
      try {
        const data = await customerApi('/api/store/postal-codes/' + postalCode, { signal: controller.signal })
        if (!current()) return
        const address = addressFromResponse(data, postalCode)
        if (!address) throw new Error('POSTAL_ADDRESS_RESPONSE_INVALID')
        const patch = {}
        for (const field of addressFields) {
          if (address[field] && manualRevisions.current[field] === revisions[field]) patch[field] = address[field]
        }
        automaticValues.current = { ...automaticValues.current, ...patch }
        setForm(previous => {
          if (!current() || digits(previous.postal_code) !== postalCode) return previous
          const next = { ...previous }
          for (const [field, value] of Object.entries(patch)) {
            if (manualRevisions.current[field] === revisions[field]) next[field] = value
          }
          return next
        })
        setLookup({ status: 'found', postalCode, partial: !address.street || !address.neighborhood })
      } catch (error) {
        if (!current()) return
        setLookup({ status: error?.status === 404 || error?.status === 400 ? 'not-found' : 'unavailable', postalCode })
      }
    }, 300)
    return () => {
      window.clearTimeout(timer)
      controller.abort()
      if (activeController.current === controller) activeController.current = null
    }
  }, [postalCode, setForm])

  const status = lookup.postalCode === postalCode ? lookup.status : 'idle'
  const message = status === 'loading'
    ? 'Buscando endereço do CEP…'
    : status === 'found'
      ? lookup.partial
        ? 'CEP localizado. Complete os campos de endereço que ficaram em branco.'
        : 'CEP localizado. Confira o endereço e complete o número e o complemento, se houver.'
      : status === 'not-found'
        ? 'CEP não encontrado. Confira o CEP ou preencha o endereço manualmente.'
        : status === 'unavailable'
          ? 'Não foi possível buscar o endereço agora. Você pode preenchê-lo manualmente.'
          : 'Ao informar o CEP, rua, bairro, cidade e estado serão preenchidos automaticamente.'

  return { changePostalCode, changeAddressField, loading: status === 'loading', message }
}
