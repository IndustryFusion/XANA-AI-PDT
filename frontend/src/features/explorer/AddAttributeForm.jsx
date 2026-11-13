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
import { shortenText, useRegistry } from './Iri'

/** The NGSI-LD attribute kinds the form offers. */
export const ADD_KINDS = ['Property', 'Relationship', 'GeoProperty', 'JsonProperty', 'LanguageProperty', 'ListProperty', 'VocabularyProperty']

const toValue = (text) => {
  const t = text.trim()
  if (/^-?\d+(\.\d+)?$/.test(t)) return Number(t)
  if (t === 'true' || t === 'false') return t === 'true'
  return t
}

function parseJson(text, what) {
  try {
    return JSON.parse(text)
  } catch {
    throw new Error(`The ${what} is not valid JSON.`)
  }
}

/** The attribute the form describes; throws with a reason when an entry is not valid. */
export function buildAttribute(form, reg) {
  const value = form.value.trim()
  switch (form.kind) {
    case 'Relationship':
      return { type: 'Relationship', object: reg.expand(value, { identifier: true }) }
    case 'GeoProperty': {
      const lon = Number(form.lon)
      const lat = Number(form.lat)
      if (form.lon.trim() === '' || form.lat.trim() === '' || Number.isNaN(lon) || Number.isNaN(lat)) throw new Error('Enter the longitude and latitude as numbers.')
      return { type: 'GeoProperty', value: { type: 'Point', coordinates: [lon, lat] } }
    }
    case 'JsonProperty':
      return { type: 'JsonProperty', json: parseJson(value, 'JSON value') }
    case 'LanguageProperty':
      if (!form.lang.trim()) throw new Error('Enter a language tag, such as en.')
      return { type: 'LanguageProperty', languageMap: { [form.lang.trim()]: value } }
    case 'ListProperty': {
      const list = parseJson(value, 'list')
      if (!Array.isArray(list)) throw new Error('The list must be a JSON array, such as [1, 2, 3].')
      return { type: 'ListProperty', valueList: list }
    }
    case 'VocabularyProperty':
      return { type: 'VocabularyProperty', vocab: reg.expand(value, { identifier: true }) }
    default:
      return { type: 'Property', value: toValue(form.value), ...(form.unit.trim() ? { unitCode: form.unit.trim() } : {}) }
  }
}

const VALUE_LABEL = {
  Property: 'Value',
  Relationship: 'Target entity ID',
  JsonProperty: 'JSON value',
  LanguageProperty: 'Text',
  ListProperty: 'List (JSON array)',
  VocabularyProperty: 'Vocabulary term',
}

/**
 * Inline form that adds an attribute to an entity, or a sub-attribute to one
 * of its attributes (`parent`, and `path` below it) when given. The name is
 * typed as `prefix:local`, a full IRI or a plain term; picking a prefix fills
 * in `prefix:`. Errors keep the form open.
 */
export default function AddAttributeForm({ entityId, parent, path = [], label, onAdded, onCancel }) {
  const reg = useRegistry()
  const [form, setForm] = useState({ name: '', kind: 'Property', value: '', unit: '', lon: '', lat: '', lang: 'en' })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const nameRef = useRef(null)
  const ids = {
    name: useId(), prefix: useId(), kind: useId(), value: useId(), unit: useId(), lon: useId(), lat: useId(), lang: useId(), error: useId(),
  }

  useEffect(() => { nameRef.current?.focus() }, [])

  const set = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }))

  function pickPrefix(e) {
    const prefix = e.target.value
    if (!prefix) return
    setForm((f) => ({ ...f, name: `${prefix}:${f.name.includes(':') ? f.name.slice(f.name.indexOf(':') + 1) : f.name}` }))
    e.target.value = ''
    nameRef.current?.focus()
  }

  async function submit(e) {
    e.preventDefault()
    setError(null)
    let name
    let attr
    try {
      name = reg.expand(form.name)
      if (!name) throw new Error('Enter a name.')
      attr = buildAttribute(form, reg)
    } catch (err) {
      setError(err)
      return
    }
    setBusy(true)
    try {
      if (parent && path.length) await entities.appendAttributes(entityId, { [parent]: { [name]: attr } }, { path })
      else if (parent) await entities.updateAttributes(entityId, { [parent]: { [name]: attr } })
      else await entities.appendAttributes(entityId, { [name]: attr })
      onAdded(parent ?? name)
    } catch (err) {
      setError(err)
      setBusy(false)
    }
  }

  const valueLabel = VALUE_LABEL[form.kind]

  return (
    <form className="add-attr" onSubmit={submit} aria-label={label} onKeyDown={(e) => { if (e.key === 'Escape') { e.stopPropagation(); onCancel() } }}>
      <fieldset className="plain-fieldset add-attr__fields" disabled={busy}>
        <div className="field">
          <label className="field__label" htmlFor={ids.prefix}>Prefix</label>
          <select id={ids.prefix} defaultValue="" onChange={pickPrefix}>
            <option value="">Choose…</option>
            {reg.entries().map((p) => <option key={p.prefix} value={p.prefix} title={p.namespace}>{p.prefix}:</option>)}
          </select>
        </div>
        <div className="field">
          <label className="field__label" htmlFor={ids.name}>Name</label>
          <input
            id={ids.name} ref={nameRef} value={form.name} onChange={set('name')} autoComplete="off" className="mono"
            placeholder="prefix:name" aria-describedby={error ? ids.error : undefined}
          />
        </div>
        <div className="field">
          <label className="field__label" htmlFor={ids.kind}>Kind</label>
          <select id={ids.kind} value={form.kind} onChange={set('kind')}>
            {ADD_KINDS.map((k) => <option key={k} value={k}>{k}</option>)}
          </select>
        </div>
        {form.kind === 'GeoProperty' ? (
          <>
            <div className="field add-attr__unit">
              <label className="field__label" htmlFor={ids.lon}>Longitude</label>
              <input id={ids.lon} value={form.lon} onChange={set('lon')} inputMode="decimal" />
            </div>
            <div className="field add-attr__unit">
              <label className="field__label" htmlFor={ids.lat}>Latitude</label>
              <input id={ids.lat} value={form.lat} onChange={set('lat')} inputMode="decimal" />
            </div>
          </>
        ) : (
          <div className="field">
            <label className="field__label" htmlFor={ids.value}>{valueLabel}</label>
            <input id={ids.value} value={form.value} onChange={set('value')} className={form.kind === 'Property' ? undefined : 'mono'} aria-describedby={error ? ids.error : undefined} />
          </div>
        )}
        {form.kind === 'LanguageProperty' && (
          <div className="field add-attr__unit">
            <label className="field__label" htmlFor={ids.lang}>Language</label>
            <input id={ids.lang} value={form.lang} onChange={set('lang')} />
          </div>
        )}
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
      {error && <p id={ids.error} className="form-error" role="alert">Not added: {shortenText(error.message)}</p>}
    </form>
  )
}
