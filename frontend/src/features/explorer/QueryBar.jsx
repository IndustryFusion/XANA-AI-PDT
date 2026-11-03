import { useId, useState } from 'react'
import { Button, Card } from '../../ui/components'
import { buildExpression, emptyCondition, OPERATORS, parseExpression, takesValue } from './query'

/** One attribute–operator–value row of the query builder. */
function ConditionRow({ index, condition, attributes, onChange, onRemove }) {
  const n = index + 1
  return (
    <li className="condition">
      <select aria-label={`Attribute of condition ${n}`} value={condition.attribute} onChange={(e) => onChange({ ...condition, attribute: e.target.value })}>
        <option value="">Attribute…</option>
        {condition.attribute && !attributes.includes(condition.attribute) && <option value={condition.attribute}>{condition.attribute}</option>}
        {attributes.map((a) => <option key={a} value={a}>{a}</option>)}
      </select>
      <select aria-label={`Operator of condition ${n}`} value={condition.op} onChange={(e) => onChange({ ...condition, op: e.target.value })}>
        {OPERATORS.map((o) => <option key={o.op} value={o.op}>{o.label}</option>)}
      </select>
      {takesValue(condition.op) && (
        <input aria-label={`Value of condition ${n}`} value={condition.value} onChange={(e) => onChange({ ...condition, value: e.target.value })} />
      )}
      <Button variant="ghost" onClick={onRemove} aria-label={`Remove condition ${n}`}>Remove</Button>
    </li>
  )
}

/**
 * Query bar: type, entity ID, ID pattern, limit and the query builder whose
 * conditions become the NGSI-LD expression shown below it. `error` is the
 * reason the last query was rejected.
 */
export default function QueryBar({ query, types, attributes, error, onApply }) {
  const parsed = parseExpression(query.q)
  const [form, setForm] = useState({ type: query.type, id: query.id, idPattern: query.idPattern, limit: query.limit })
  const [conditions, setConditions] = useState(parsed?.conditions ?? [])
  const [combine, setCombine] = useState(parsed?.combine ?? 'and')
  const ids = { type: useId(), id: useId(), pattern: useId(), limit: useId(), expr: useId(), error: useId() }
  const expression = parsed || conditions.length ? buildExpression(conditions, combine) : query.q
  const set = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }))

  function submit(e) {
    e.preventDefault()
    onApply({ ...form, q: expression })
  }

  return (
    <Card title="Query" className="query-bar">
      <form onSubmit={submit} aria-describedby={error ? ids.error : undefined} className="stack">
        <div className="field-row">
          <div className="field">
            <label className="field__label" htmlFor={ids.type}>Entity type</label>
            <select id={ids.type} value={form.type} onChange={set('type')}>
              <option value="">Any type</option>
              {form.type && !types.includes(form.type) && <option value={form.type}>{form.type}</option>}
              {types.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
          </div>
          <div className="field">
            <label className="field__label" htmlFor={ids.id}>Entity ID</label>
            <input id={ids.id} value={form.id} onChange={set('id')} placeholder="urn:ngsi-ld:…" />
          </div>
          <div className="field">
            <label className="field__label" htmlFor={ids.pattern}>ID pattern</label>
            <input id={ids.pattern} value={form.idPattern} onChange={set('idPattern')} placeholder="Regular expression" />
          </div>
          <div className="field query-bar__limit">
            <label className="field__label" htmlFor={ids.limit}>Limit</label>
            <input id={ids.limit} type="number" min="1" max="1000" value={form.limit} onChange={set('limit')} />
          </div>
        </div>

        <fieldset className="plain-fieldset stack query-builder">
          <legend className="field__label">Attribute conditions</legend>
          {conditions.length > 0 && (
            <ol className="query-builder__list">
              {conditions.map((c, i) => (
                <ConditionRow
                  key={i} index={i} condition={c} attributes={attributes}
                  onChange={(next) => setConditions((all) => all.map((x, j) => (j === i ? next : x)))}
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
            <output id={ids.expr} className="mono query-builder__expression">{expression || <span className="muted">No conditions</span>}</output>
          </div>
        </fieldset>

        <div className="row">
          <Button type="submit" variant="primary">Apply query</Button>
          {error && <p id={ids.error} className="form-error" role="alert">The query was rejected: {error.message}</p>}
        </div>
      </form>
    </Card>
  )
}
