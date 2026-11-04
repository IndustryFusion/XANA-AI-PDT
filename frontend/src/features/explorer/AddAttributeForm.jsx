//
// Copyright (c) 2026 IndustryFusion Foundation
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//   http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.
//

import { useEffect, useId, useRef, useState } from 'react'
import { entities } from '../../data'
import { Button } from '../../ui/components'

const toValue = (text) => {
  const t = text.trim()
  if (/^-?\d+(\.\d+)?$/.test(t)) return Number(t)
  if (t === 'true' || t === 'false') return t === 'true'
  return t
}

/**
 * Inline form that adds an attribute to an entity, or a sub-attribute to one
 * of its attributes when `parent` is given. Errors keep the form open.
 */
export default function AddAttributeForm({ entityId, parent, label, onAdded, onCancel }) {
  const [form, setForm] = useState({ name: '', kind: 'Property', value: '', unit: '' })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const nameRef = useRef(null)
  const ids = { name: useId(), kind: useId(), value: useId(), unit: useId(), error: useId() }

  useEffect(() => { nameRef.current?.focus() }, [])

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
      onAdded(parent ?? name)
    } catch (err) {
      setError(err)
      setBusy(false)
    }
  }

  return (
    <form className="add-attr" onSubmit={submit} aria-label={label} onKeyDown={(e) => { if (e.key === 'Escape') { e.stopPropagation(); onCancel() } }}>
      <fieldset className="plain-fieldset add-attr__fields" disabled={busy}>
        <div className="field">
          <label className="field__label" htmlFor={ids.name}>Name</label>
          <input id={ids.name} ref={nameRef} value={form.name} onChange={set('name')} autoComplete="off" className="mono" />
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
          <input id={ids.value} value={form.value} onChange={set('value')} aria-describedby={error ? ids.error : undefined} />
        </div>
        {form.kind === 'Property' && (
          <div className="field add-attr__unit">
            <label className="field__label" htmlFor={ids.unit}>Unit (optional)</label>
            <input id={ids.unit} value={form.unit} onChange={set('unit')} />
          </div>
        )}
        <div className="row add-attr__buttons">
          <Button type="submit" variant="primary" size="sm">{busy ? 'Adding…' : 'Add'}</Button>
          <Button size="sm" onClick={onCancel}>Cancel</Button>
        </div>
      </fieldset>
      {error && <p id={ids.error} className="form-error" role="alert">Not added: {error.message}</p>}
    </form>
  )
}
