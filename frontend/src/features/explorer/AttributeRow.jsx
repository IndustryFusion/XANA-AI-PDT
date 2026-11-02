import { useEffect, useId, useRef, useState } from 'react'
import { entities } from '../../data'
import { useData } from '../../data/useData'
import { Button } from '../../ui/components'
import { attributeKind, editableValue, hasHistory, iriOf, kindInfo, parseInput, subAttributesOf } from './attributes'
import AttributeValue, { AttributeMeta } from './AttributeValue'

/**
 * Inline editor of an attribute value, with the data model's suggested
 * values. A rejected change keeps the editor open with the entered value.
 */
function AttributeEditor({ entity, name, attr, onSaved, onCancel }) {
  const [member, current] = editableValue(attr)
  const shown = member === 'value' && iriOf(attr.value) ? iriOf(attr.value) : current
  const [text, setText] = useState(shown == null ? '' : String(shown))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const inputRef = useRef(null)
  const ids = { input: useId(), hints: useId(), error: useId() }
  const hints = useData('entities', 'getValueHints', [{ entityType: entity.type, attribute: name }])
  const suggestions = (hints.data ?? []).filter((h) => h !== text)

  useEffect(() => { inputRef.current?.focus() }, [])

  async function save(e) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      await entities.updateAttributes(entity.id, { [name]: { [member]: parseInput(text, current, member) } })
      onSaved(name)
    } catch (err) {
      setError(err)
      setBusy(false)
    }
  }

  return (
    <form className="attr-editor" onSubmit={save} aria-label={`Edit ${name}`}>
      <fieldset className="plain-fieldset stack" disabled={busy}>
        <div className="field">
          <label className="field__label" htmlFor={ids.input}>New value of {name}{attr.unitCode ? ` (${attr.unitCode})` : ''}</label>
          <input
            id={ids.input} ref={inputRef} value={text} list={hints.data?.length ? ids.hints : undefined}
            onChange={(e) => setText(e.target.value)}
            aria-invalid={error ? true : undefined} aria-describedby={error ? ids.error : undefined}
            onKeyDown={(e) => { if (e.key === 'Escape') { e.stopPropagation(); onCancel() } }}
          />
          {hints.data?.length > 0 && <datalist id={ids.hints}>{hints.data.map((h) => <option key={h} value={h} />)}</datalist>}
        </div>
        {suggestions.length > 0 && (
          <div className="row" role="group" aria-label="Suggested values">
            <span className="muted">Suggested:</span>
            {suggestions.map((h) => <Button key={h} size="sm" onClick={() => setText(h)}>{h}</Button>)}
          </div>
        )}
        {error && <p id={ids.error} className="form-error" role="alert">Not saved: {error.message}</p>}
        <div className="row">
          <Button type="submit" variant="primary" size="sm">{busy ? 'Saving…' : 'Save'}</Button>
          <Button size="sm" onClick={onCancel}>Cancel</Button>
        </div>
      </fieldset>
    </form>
  )
}

/**
 * One attribute: name, kind label, value, metadata, sub-attributes and the
 * actions allowed in the current view (none in a historical view).
 */
export default function AttributeRow({ entity, name, attr, readOnly, changed, refTo, onSaved, onHistory, onAddSub, onDelete, historyOpen }) {
  const [editing, setEditing] = useState(false)
  const instances = Array.isArray(attr) ? attr : [attr]
  const kind = attributeKind(attr)
  const editable = !readOnly && editableValue(attr)

  return (
    <li className={`attr${changed ? ' attr--changed' : ''}`} data-attribute={name}>
      <div className="attr__head">
        <span className="attr__name mono">{name}</span>
        <span className="kind-tag">{kindInfo(kind).label}</span>
        {changed && <span className="attr__changed">Updated</span>}
        <span className="attr__actions">
          {editable && !editing && <Button size="sm" variant="ghost" onClick={() => setEditing(true)} aria-label={`Edit ${name}`}>Edit</Button>}
          {hasHistory(attr) && (
            <Button size="sm" variant="ghost" onClick={() => onHistory(name)} aria-pressed={historyOpen} aria-label={`History of ${name}`}>History</Button>
          )}
          {!readOnly && !Array.isArray(attr) && <Button size="sm" variant="ghost" onClick={() => onAddSub(name)} aria-label={`Add sub-attribute to ${name}`}>Add sub-attribute</Button>}
          {!readOnly && <Button size="sm" variant="ghost" onClick={() => onDelete(name)} aria-label={`Delete ${name}`}>Delete</Button>}
        </span>
      </div>
      {editing ? (
        <AttributeEditor entity={entity} name={name} attr={attr} onCancel={() => setEditing(false)} onSaved={(n) => { setEditing(false); onSaved(n) }} />
      ) : instances.map((inst, i) => (
        <div key={inst.datasetId ?? i} className="attr__instance">
          <div className="attr__value"><AttributeValue attr={inst} refTo={refTo} /></div>
          <AttributeMeta attr={inst} />
          {subAttributesOf(inst).length > 0 && (
            <ul className="attr__subs" aria-label={`Sub-attributes of ${name}`}>
              {subAttributesOf(inst).map(([sub, subAttr]) => (
                <li key={sub} className="attr attr--sub" data-attribute={`${name}.${sub}`}>
                  <div className="attr__head">
                    <span className="attr__name mono">{sub}</span>
                    <span className="kind-tag">{kindInfo(attributeKind(subAttr)).label}</span>
                    {!readOnly && (
                      <span className="attr__actions">
                        <Button size="sm" variant="ghost" onClick={() => onDelete(name, sub)} aria-label={`Delete sub-attribute ${sub} of ${name}`}>Delete</Button>
                      </span>
                    )}
                  </div>
                  <div className="attr__value"><AttributeValue attr={subAttr} refTo={refTo} /></div>
                  <AttributeMeta attr={subAttr} />
                </li>
              ))}
            </ul>
          )}
        </div>
      ))}
    </li>
  )
}
