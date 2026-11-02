import { useEffect, useId, useState } from 'react'
import { entities } from '../../data'
import { Button, Dialog } from '../../ui/components'

const toValue = (text) => {
  const t = text.trim()
  if (/^-?\d+(\.\d+)?$/.test(t)) return Number(t)
  if (t === 'true' || t === 'false') return t === 'true'
  return t
}

/**
 * Adds an attribute to an entity, or a sub-attribute to one of its
 * attributes when `parent` is given. Errors keep the dialog open.
 */
export default function AddAttributeDialog({ open, entityId, parent, onClose, onAdded }) {
  const [form, setForm] = useState({ name: '', kind: 'Property', value: '', unit: '' })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const ids = { form: useId(), name: useId(), kind: useId(), value: useId(), unit: useId() }

  useEffect(() => {
    if (open) {
      setForm({ name: '', kind: 'Property', value: '', unit: '' })
      setError(null)
    }
  }, [open])

  const set = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }))

  async function submit(e) {
    e.preventDefault()
    const name = form.name.trim()
    const attr = form.kind === 'Relationship'
      ? { type: 'Relationship', object: form.value.trim() }
      : { type: 'Property', value: toValue(form.value), ...(form.unit.trim() ? { unitCode: form.unit.trim() } : {}) }
    setBusy(true)
    setError(null)
    try {
      if (parent) await entities.updateAttributes(entityId, { [parent]: { [name]: attr } })
      else await entities.appendAttributes(entityId, { [name]: attr })
      setBusy(false)
      onAdded(parent ?? name)
      onClose()
    } catch (err) {
      setError(err)
      setBusy(false)
    }
  }

  return (
    <Dialog
      open={open}
      title={parent ? `Add a sub-attribute to ${parent}` : 'Add an attribute'}
      busy={busy}
      onClose={onClose}
      footer={(
        <>
          <Button onClick={onClose} disabled={busy}>Cancel</Button>
          <Button type="submit" form={ids.form} variant="primary" disabled={busy}>{busy ? 'Adding…' : 'Add'}</Button>
        </>
      )}
    >
      <form id={ids.form} onSubmit={submit} className="stack">
        <div className="field">
          <label className="field__label" htmlFor={ids.name}>Name</label>
          <input id={ids.name} value={form.name} onChange={set('name')} autoComplete="off" />
        </div>
        <div className="field">
          <label className="field__label" htmlFor={ids.kind}>Kind</label>
          <select id={ids.kind} value={form.kind} onChange={set('kind')}>
            <option value="Property">Property</option>
            <option value="Relationship">Relationship</option>
          </select>
        </div>
        <div className="field">
          <label className="field__label" htmlFor={ids.value}>{form.kind === 'Relationship' ? 'Target entity ID' : 'Value'}</label>
          <input id={ids.value} value={form.value} onChange={set('value')} />
        </div>
        {form.kind === 'Property' && (
          <div className="field">
            <label className="field__label" htmlFor={ids.unit}>Unit (optional)</label>
            <input id={ids.unit} value={form.unit} onChange={set('unit')} />
          </div>
        )}
        {error && <p className="form-error" role="alert">Not added: {error.message}</p>}
      </form>
    </Dialog>
  )
}
