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

import { useId, useState } from 'react'
import { Button } from '../../ui/components'
import { IconButton } from '../../ui/icons'
import { attributeKind } from './attributes'
import { shortenText, useRegistry } from './Iri'
import { isHttpIri, UnknownPrefixError } from './prefixes'
import { buildExpression, DEFAULT_LIMIT, emptyCondition, OPERATORS, parseExpression, takesValue } from './query'
import { useKept } from './store'

/** Options of a list of IRIs: the short name shown, the full IRI as tooltip. */
function NameOptions({ id, names, reg }) {
  return (
    <datalist id={id}>
      {names.map((n) => <option key={n} value={reg.shorten(n)} title={isHttpIri(n) ? n : undefined} />)}
    </datalist>
  )
}

/** Attributes whose values are IRIs in the entities shown: relationships and IRI values. */
function iriAttributes(entities) {
  const names = new Set()
  for (const e of entities ?? []) {
    for (const [name, attr] of Object.entries(e)) {
      const kind = attributeKind(attr)
      if (kind === 'relationship' || kind === 'iri') names.add(name)
    }
  }
  return names
}

/** One attribute–operator–value row of the query builder. */
function ConditionRow({ index, condition, attributes, reg, error, onChange, onRemove }) {
  const n = index + 1
  const ids = { iri: useId(), error: useId() }
  return (
    <li className="condition">
      <select aria-label={`Attribute of condition ${n}`} value={condition.attribute} onChange={(e) => onChange({ ...condition, attribute: e.target.value })}>
        <option value="">Attribute…</option>
        {condition.attribute && !attributes.includes(condition.attribute) && <option value={condition.attribute}>{reg.shorten(condition.attribute)}</option>}
        {attributes.map((a) => <option key={a} value={a} title={isHttpIri(a) ? a : undefined}>{reg.shorten(a)}</option>)}
      </select>
      <select aria-label={`Operator of condition ${n}`} value={condition.op} onChange={(e) => onChange({ ...condition, op: e.target.value })}>
        {OPERATORS.map((o) => <option key={o.op} value={o.op}>{o.label}</option>)}
      </select>
      {takesValue(condition.op) && (
        <>
          <input
            aria-label={`Value of condition ${n}`} value={condition.value} onChange={(e) => onChange({ ...condition, value: e.target.value })}
            aria-invalid={error ? true : undefined} aria-describedby={error ? ids.error : undefined}
          />
          <label className="row condition__iri" htmlFor={ids.iri}>
            <input id={ids.iri} type="checkbox" checked={!!condition.iri} onChange={(e) => onChange({ ...condition, iri: e.target.checked })} />
            IRI
          </label>
        </>
      )}
      <IconButton icon="delete" tone="muted" onClick={onRemove} label={`Remove condition ${n}`} />
      {error && <span id={ids.error} className="field__error" role="alert">{error}</span>}
    </li>
  )
}

/** A set filter shown as a chip while the further filters are collapsed. */
function Chip({ label, onRemove }) {
  return (
    <li className="chip">
      <span>{label}</span>
      <IconButton icon="close" label={`Remove filter ${label}`} onClick={onRemove} className="chip__remove" />
    </li>
  )
}

/**
 * Query bar: type, entity ID and Search on one row; ID pattern,
 * has-attribute, attributes to return, limit and the query builder in a
 * collapsible section, shown as removable chips while it is collapsed.
 * IRIs are shown and typed as short names (`prefix:local`) and expanded
 * before the query is applied; an unknown prefix is reported at its input.
 * `error` is the reason the last query was rejected.
 */
export default function QueryBar({ query, types, attributes, entities = [], error, onApply, past = false }) {
  const reg = useRegistry()
  const parsed = parseExpression(query.q)
  const short = (v) => (v ? reg.shorten(v) : '')
  const [form, setForm] = useState({
    type: short(query.type), id: short(query.id), idPattern: reg.shortenPattern(query.idPattern), limit: query.limit, hasAttr: short(query.hasAttr ?? ''),
  })
  const [selected, setSelected] = useState(() => (query.attrs ? query.attrs.split(',').filter(Boolean) : []))
  const [adding, setAdding] = useState('')
  const iriNames = iriAttributes(entities)
  const [conditions, setConditions] = useState(() => (parsed?.conditions ?? []).map((c) => ({
    ...c, iri: iriNames.has(c.attribute) || isHttpIri(c.value), value: isHttpIri(c.value) ? reg.shorten(c.value) : c.value,
  })))
  const [combine, setCombine] = useState(parsed?.combine ?? 'and')
  const [open, setOpen] = useKept('filtersOpen', false)
  const [problems, setProblems] = useState({})
  const ids = {
    type: useId(), id: useId(), pattern: useId(), limit: useId(), expr: useId(), error: useId(), attrs: useId(), has: useId(),
    more: useId(), names: useId(), types: useId(),
  }
  const choices = [...new Set([...attributes, ...selected])]
  const set = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }))

  /** The query the form describes, with every short name expanded; throws `{ field: reason }`. */
  function expanded(f = form, list = conditions, attrs = selected) {
    const found = {}
    const take = (field, fn) => {
      try {
        return fn()
      } catch (e) {
        if (!(e instanceof UnknownPrefixError)) throw e
        found[field] = e.message
        return ''
      }
    }
    const pattern = f.idPattern.trim()
    const out = {
      type: take('type', () => reg.expand(f.type)),
      id: take('id', () => reg.expand(f.id, { identifier: true })),
      // Only the start of a pattern can be a short name; the rest is a regular expression.
      idPattern: take('idPattern', () => reg.expandPattern(pattern)),
      hasAttr: take('hasAttr', () => reg.expand(f.hasAttr)),
      limit: f.limit,
    }
    const conds = list.map((c, i) => ({
      ...c,
      attribute: take(`attribute${i}`, () => reg.expand(c.attribute)),
      value: c.iri ? take(`value${i}`, () => reg.expand(c.value, { identifier: true })) : c.value,
    }))
    const q = parsed || list.length ? buildExpression(conds, combine) : query.q
    if (Object.keys(found).length) throw found
    return { ...out, q, attrs: attrs.join(','), offset: '0' }
  }

  function apply(f, list, attrs, override = {}) {
    try {
      const next = { ...expanded(f, list, attrs), ...override }
      setProblems({})
      onApply(next)
    } catch (found) {
      if (found instanceof Error) throw found
      setProblems(found)
      if (Object.keys(found).some((k) => k !== 'type' && k !== 'id')) setOpen(true)
    }
  }

  function submit(e) {
    e.preventDefault()
    // A new query starts again at the first page.
    apply(form, conditions, selected)
  }

  function addAttribute() {
    try {
      const name = reg.expand(adding)
      if (name && !selected.includes(name)) setSelected((s) => [...s, name])
      setAdding('')
      setProblems((p) => ({ ...p, attrs: undefined }))
    } catch (err) {
      if (!(err instanceof UnknownPrefixError)) throw err
      setProblems((p) => ({ ...p, attrs: err.message }))
    }
  }

  let shownExpression = ''
  try { shownExpression = expanded().q } catch { shownExpression = parsed || conditions.length ? buildExpression(conditions, combine) : query.q }

  const chips = []
  if (!open) {
    if (form.idPattern) chips.push(['ID pattern', `ID pattern ${form.idPattern}`, () => ({ form: { ...form, idPattern: '' } })])
    if (form.hasAttr && !past) chips.push(['Has attribute', `has ${form.hasAttr}`, () => ({ form: { ...form, hasAttr: '' } })])
    if (selected.length && !past) chips.push(['Attributes', `returns ${selected.map(short).join(', ')}`, () => ({ attrs: [] })])
    if (form.limit && String(form.limit) !== String(DEFAULT_LIMIT)) chips.push(['Limit', `limit ${form.limit}`, () => ({ form: { ...form, limit: String(DEFAULT_LIMIT) } })])
    if (shownExpression) chips.push(['Conditions', `where ${shortenText(shownExpression)}`, () => ({ list: [], q: true })])
  }

  function removeChip(change) {
    const next = change()
    const f = next.form ?? form
    const list = next.list ?? conditions
    const attrs = next.attrs ?? selected
    setForm(f)
    setConditions(list)
    setSelected(attrs)
    apply(f, list, attrs, next.q ? { q: '' } : {})
  }

  const fieldError = (key) => problems[key] && <span id={`${ids.error}-${key}`} className="field__error" role="alert">{problems[key]}</span>
  const describe = (key) => (problems[key] ? `${ids.error}-${key}` : undefined)

  return (
    <section className="query-bar card" aria-label="Query">
      <form onSubmit={submit} aria-describedby={error ? ids.error : undefined} className="query-bar__form">
        <div className="query-bar__main">
          <div className="field query-bar__type">
            <label className="field__label" htmlFor={ids.type}>Entity type</label>
            <input
              id={ids.type} list={ids.types} value={form.type} onChange={set('type')} placeholder="Any type" autoComplete="off"
              className="mono" aria-invalid={problems.type ? true : undefined} aria-describedby={describe('type')}
            />
            <NameOptions id={ids.types} names={types} reg={reg} />
            {fieldError('type')}
          </div>
          <div className="field query-bar__id">
            <label className="field__label" htmlFor={ids.id}>Entity ID</label>
            <input
              id={ids.id} value={form.id} onChange={set('id')} placeholder="urn:ngsi-ld:…" className="mono"
              aria-invalid={problems.id ? true : undefined} aria-describedby={describe('id')}
            />
            {fieldError('id')}
          </div>
          <Button type="submit" variant="primary">Search</Button>
          <button
            type="button" className="query-bar__more" aria-expanded={open} aria-controls={open ? ids.more : undefined}
            onClick={() => setOpen((o) => !o)}
          >
            More filters
          </button>
          {chips.length > 0 && (
            <ul className="chips" aria-label="Filters">
              {chips.map(([key, label, change]) => <Chip key={key} label={label} onRemove={() => removeChip(change)} />)}
            </ul>
          )}
        </div>

        {open && (
          <div id={ids.more} className="query-bar__more-filters stack">
            <div className="field-row">
              <div className="field">
                <label className="field__label" htmlFor={ids.pattern}>ID pattern</label>
                <input
                  id={ids.pattern} value={form.idPattern} onChange={set('idPattern')} placeholder="Regular expression" className="mono"
                  aria-invalid={problems.idPattern ? true : undefined} aria-describedby={describe('idPattern')}
                />
                {fieldError('idPattern')}
              </div>
              {!past && (
                <div className="field">
                  <label className="field__label" htmlFor={ids.has}>Has attribute</label>
                  <input
                    id={ids.has} list={ids.names} value={form.hasAttr} onChange={set('hasAttr')} placeholder="Any" autoComplete="off" className="mono"
                    aria-invalid={problems.hasAttr ? true : undefined} aria-describedby={describe('hasAttr')}
                  />
                  {fieldError('hasAttr')}
                </div>
              )}
              {!past && (
                <div className="field">
                  <label className="field__label" htmlFor={ids.attrs}>Attributes to return</label>
                  <div className="row query-bar__attrs">
                    <input
                      id={ids.attrs} list={ids.names} value={adding} onChange={(e) => setAdding(e.target.value)} autoComplete="off" className="mono"
                      placeholder="All attributes" aria-describedby={problems.attrs ? describe('attrs') : `${ids.attrs}-hint`}
                      onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addAttribute() } }}
                    />
                    <IconButton icon="add" label="Add attribute to return" onClick={addAttribute} disabled={!adding.trim()} />
                  </div>
                  {selected.length > 0 && (
                    <ul className="chips" aria-label="Attributes to return">
                      {selected.map((a) => (
                        <li key={a} className="chip">
                          <span title={isHttpIri(a) ? a : undefined}>{short(a)}</span>
                          <IconButton icon="close" className="chip__remove" label={`Do not return ${short(a)}`} onClick={() => setSelected((s) => s.filter((x) => x !== a))} />
                        </li>
                      ))}
                    </ul>
                  )}
                  {fieldError('attrs') || <p id={`${ids.attrs}-hint`} className="muted field__hint">None chosen returns every attribute.</p>}
                </div>
              )}
              <div className="field query-bar__limit">
                <label className="field__label" htmlFor={ids.limit}>Limit</label>
                <input id={ids.limit} type="number" min="1" max="1000" value={form.limit} onChange={set('limit')} />
              </div>
              <NameOptions id={ids.names} names={choices} reg={reg} />
            </div>

            <fieldset className="plain-fieldset stack query-builder">
              <legend className="field__label">Attribute conditions</legend>
              {conditions.length > 0 && (
                <ol className="query-builder__list">
                  {conditions.map((c, i) => (
                    <ConditionRow
                      key={i} index={i} condition={c} attributes={attributes} reg={reg} error={problems[`value${i}`] ?? problems[`attribute${i}`]}
                      onChange={(next) => setConditions((all) => all.map((x, j) => (j === i ? { ...next, iri: next.attribute !== x.attribute && iriNames.has(next.attribute) ? true : next.iri } : x)))}
                      onRemove={() => setConditions((all) => all.filter((_, j) => j !== i))}
                    />
                  ))}
                </ol>
              )}
              <div className="row">
                <Button size="sm" onClick={() => setConditions((all) => [...all, emptyCondition()])}>Add condition</Button>
                {conditions.length > 1 && (
                  <div className="row" role="radiogroup" aria-label="Combine conditions">
                    <label className="row"><input type="radio" name="combine" value="and" checked={combine === 'and'} onChange={() => setCombine('and')} /> All conditions (AND)</label>
                    <label className="row"><input type="radio" name="combine" value="or" checked={combine === 'or'} onChange={() => setCombine('or')} /> Any condition (OR)</label>
                  </div>
                )}
              </div>
              <div className="field">
                <label className="field__label" htmlFor={ids.expr}>Query expression</label>
                <output id={ids.expr} className="mono query-builder__expression">{shownExpression ? shortenText(shownExpression) : <span className="muted">No conditions</span>}</output>
              </div>
            </fieldset>
          </div>
        )}
        {error && <p id={ids.error} className="form-error" role="alert">The query was rejected: {shortenText(error.message)}</p>}
      </form>
    </section>
  )
}
