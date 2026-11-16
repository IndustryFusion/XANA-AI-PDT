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
import { useData } from '../../data/useData'
import { Button } from '../../ui/components'
import { IconButton } from '../../ui/icons'
import { DATATYPES, OTHER_DATATYPE, datatypeIri, datatypeLabel } from './attributes'
import { shortenText } from './Iri'
import { isHttpIri, registry } from './prefixes'

/** Said of a plain string that reads as a number. */
export const NUMBER_TEXT_HINT = 'A number written as text: the platform’s check of a double accepts it, as a value without a datatype counts as the one expected.'

/** The choice that lets the operator enter any other unit code. */
const OTHER_UNIT = 'other'

/** `CEL · °C · degree Celsius`; a code the catalogue doesn't know as it is. */
export const unitText = (u) => [u.code, u.symbol, u.name].filter(Boolean).join(' · ')

/**
 * The units to offer: the ones the data model allows, else every known one; the stored unit is always
 * among them, so the choice shows it.
 */
export function unitChoicesOf(allowed, known, current) {
  const byCode = Object.fromEntries(known.map((u) => [u.code, u]))
  const codes = allowed.length ? allowed : known.map((u) => u.code)
  const list = codes.map((code) => byCode[code] ?? { code })
  return current && !codes.includes(current) ? [...list, byCode[current] ?? { code: current }] : list
}

/** Why a unit code is refused, or null: not one the data model allows, or no known UN/CEFACT code. */
export function unitRefusal(code, allowed, known, knownLoaded) {
  if (allowed.length && !allowed.includes(code)) return `${code} is not a unit the data model allows here (${allowed.join(', ')}).`
  if (!allowed.length && knownLoaded && !known.some((u) => u.code === code)) return `${code} is not a known UN/CEFACT unit code.`
  return null
}

/** The allowed range in words, saying whether each limit is included; null without one. */
export function rangeText(hint) {
  if (!hint || (hint.minimum == null && hint.maximum == null)) return null
  const low = hint.minimum == null ? null : `${hint.minimumExclusive ? 'above' : 'from'} ${hint.minimum}`
  const high = hint.maximum == null ? null : `${hint.maximumExclusive ? 'below' : 'up to'} ${hint.maximum}`
  return `Allowed: ${[low, high].filter(Boolean).join(', ')}`
}

/**
 * In-place editor of one value: an input that offers the data model's
 * suggested values as a list (arrow keys move through it, Enter picks one),
 * and says what range is allowed. Without hints it works just the same.
 * Enter or ✓ saves, Escape or ✗ cancels. A rejected change keeps the
 * editor open with the entered value and shows the reason.
 *
 * `datatype` is the value's datatype as the platform reads it (a full IRI), preset in a choice of
 * datatypes; picking another one changes it. `numberText` marks a plain string that reads as a number.
 *
 * `unit` is the value's `unitCode` (null without one); given, the editor offers a choice of units: the
 * ones the data model allows for the attribute, else the known UN/CEFACT codes, each with its symbol
 * and name, and any other code after a warning. Left out, there is no unit to choose.
 */
export default function ValueEditor({ label, initial, entityType, attribute, iri = false, datatype = null, numberText = false, unit, onSave, onCancel }) {
  const [text, setText] = useState(initial == null ? '' : String(initial))
  // The datatype the editing started from: a live update while the editor is open changes nothing here.
  const [from] = useState(datatype)
  const known = DATATYPES.some((d) => d.id === from)
  const choices = from && !known ? [...DATATYPES, { id: from, label: datatypeLabel(from) }] : DATATYPES
  const [choice, setChoice] = useState(from)
  const [otherIri, setOtherIri] = useState('')
  const chosen = choice === OTHER_DATATYPE ? (otherIri.trim() ? datatypeIri(otherIri) : null) : choice
  const typeChanged = from && chosen && chosen !== from
  const [active, setActive] = useState(-1)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const inputRef = useRef(null)
  const ids = { input: useId(), list: useId(), error: useId(), type: useId(), other: useId(), unit: useId(), otherUnit: useId() }
  const hints = useData('entities', 'getValueHints', [{ entityType, attribute }])
  const withUnit = unit !== undefined
  const catalogue = useData('entities', 'getUnits', [], { enabled: withUnit })
  // The unit the editing started from, as for the datatype: a live update meanwhile is no change by the operator.
  const [unitFrom] = useState(unit ?? null)
  const [unitChoice, setUnitChoice] = useState(unitFrom ?? '')
  const [otherUnit, setOtherUnit] = useState('')
  // What the operator insisted on after its warning: the value, until the text or datatype changes, and
  // the unit, until another unit is chosen. Each is saved anyway only for itself.
  const [valueInsisted, setValueInsisted] = useState(false)
  const [unitInsisted, setUnitInsisted] = useState(false)
  const allowedUnits = hints.data?.units ?? []
  const knownUnits = catalogue.data?.units ?? []
  const unitOptions = unitChoicesOf(allowedUnits, knownUnits, unitFrom)
  const chosenUnit = unitChoice === OTHER_UNIT ? otherUnit.trim() : (unitChoice || null)
  const unitChanged = withUnit && chosenUnit !== unitFrom
  // Suggested IRIs are offered and entered as short names; saving expands them again.
  const shown = (h) => (iri || isHttpIri(h) ? registry.shorten(h) : h)
  const options = (hints.data?.values ?? []).map(shown).filter((h) => h !== text)
  const fullOf = Object.fromEntries((hints.data?.values ?? []).map((h) => [shown(h), h]))
  const range = rangeText(hints.data)

  useEffect(() => { inputRef.current?.focus() }, [])

  /** A new text ends any choice in the list, at once: Enter right after a pick must save, not pick again. */
  function changeText(next) {
    setText(next)
    setValueInsisted(false)
    setActive(-1)
  }

  /**
   * `force`: the operator insists on a value the checks refused, for example to test how the system reacts.
   * `unitAnyway`: they insist on a unit that was refused; the value's own checks still apply.
   */
  async function save(force = valueInsisted, unitAnyway = unitInsisted) {
    if (force !== valueInsisted) setValueInsisted(force)
    if (unitAnyway !== unitInsisted) setUnitInsisted(unitAnyway)
    if (from && !chosen) {
      setError({ message: 'Enter the IRI of the datatype.' })
      return
    }
    if (unitChanged && chosenUnit === '') {
      setError({ message: 'Enter the unit code.' })
      return
    }
    const unitProblem = unitChanged && chosenUnit && !unitAnyway ? unitRefusal(chosenUnit, allowedUnits, knownUnits, catalogue.status === 'success') : null
    if (unitProblem) {
      setError({ kind: 'unit', message: unitProblem })
      return
    }
    setBusy(true)
    setError(null)
    try {
      await onSave(!iri && fullOf[text] ? fullOf[text] : text, {
        ...(force ? { force: true } : {}), ...(from ? { datatype: chosen, from } : {}), ...(unitChanged ? { unit: chosenUnit } : {}),
      })
    } catch (err) {
      setError(err)
      setBusy(false)
      inputRef.current?.focus()
    }
  }

  function onKeyDown(e) {
    if (e.key === 'Escape') {
      e.preventDefault()
      e.stopPropagation()
      onCancel()
    } else if (e.key === 'ArrowDown' && options.length) {
      e.preventDefault()
      setActive((a) => (a + 1) % options.length)
    } else if (e.key === 'ArrowUp' && options.length) {
      e.preventDefault()
      setActive((a) => (a <= 0 ? options.length - 1 : a - 1))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      if (active >= 0 && options[active] !== undefined) changeText(options[active])
      else if (!busy) save()
    }
  }

  const optionId = (i) => `${ids.list}-${i}`
  const listed = options.length > 0

  return (
    <div className="value-editor" role="group" aria-label={`Edit ${label}`}>
      <div className="value-editor__row">
        <label className="visually-hidden" htmlFor={ids.input}>New value of {label}</label>
        <input
          id={ids.input} ref={inputRef} value={text} readOnly={busy} autoComplete="off"
          className="value-editor__input mono"
          role="combobox" aria-autocomplete="list" aria-expanded={listed}
          aria-controls={listed ? ids.list : undefined}
          aria-activedescendant={active >= 0 && listed ? optionId(active) : undefined}
          aria-invalid={error ? true : undefined} aria-describedby={error ? ids.error : undefined}
          onChange={(e) => changeText(e.target.value)}
          onKeyDown={onKeyDown}
        />
        {from && (
          <>
            <label className="visually-hidden" htmlFor={ids.type}>Datatype of {label}</label>
            <select id={ids.type} className="value-editor__type mono" value={choice} disabled={busy} onChange={(e) => { setChoice(e.target.value); setValueInsisted(false); setError(null) }}>
              {choices.map((d) => <option key={d.id} value={d.id}>{d.label}</option>)}
              <option value={OTHER_DATATYPE}>Other IRI…</option>
            </select>
            {choice === OTHER_DATATYPE && (
              <>
                <label className="visually-hidden" htmlFor={ids.other}>Datatype IRI of {label}</label>
                <input id={ids.other} className="value-editor__other mono" value={otherIri} placeholder="xsd:anyURI" disabled={busy} autoComplete="off" onChange={(e) => { setOtherIri(e.target.value); setError(null) }} />
              </>
            )}
          </>
        )}
        {withUnit && (
          <>
            <label className="visually-hidden" htmlFor={ids.unit}>Unit of {label}</label>
            <select id={ids.unit} className="value-editor__unit mono" value={unitChoice} disabled={busy} onChange={(e) => { setUnitChoice(e.target.value); setUnitInsisted(false); setError(null) }}>
              <option value="">No unit</option>
              {unitOptions.map((u) => <option key={u.code} value={u.code}>{unitText(u)}</option>)}
              <option value={OTHER_UNIT}>Other code…</option>
            </select>
            {unitChoice === OTHER_UNIT && (
              <>
                <label className="visually-hidden" htmlFor={ids.otherUnit}>Unit code of {label}</label>
                <input id={ids.otherUnit} className="value-editor__other mono" value={otherUnit} placeholder="CEL" disabled={busy} autoComplete="off" onChange={(e) => { setOtherUnit(e.target.value); setUnitInsisted(false); setError(null) }} />
              </>
            )}
          </>
        )}
        <IconButton icon="save" tone="primary" onClick={() => save()} disabled={busy} label={`Save ${label}`} tooltip="Save" />
        <IconButton icon="cancel" onClick={onCancel} disabled={busy} label={`Cancel editing ${label}`} tooltip="Cancel" />
        {busy && <span className="muted">Saving…</span>}
      </div>
      {listed && (
        <ul id={ids.list} role="listbox" aria-label="Suggested values" className="value-editor__list">
          {options.map((h, i) => (
            <li
              key={h} id={optionId(i)} role="option" aria-selected={i === active}
              className="value-editor__option mono"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => { changeText(h); inputRef.current?.focus() }}
              title={fullOf[h] !== h ? fullOf[h] : undefined}
            >
              {h}
            </li>
          ))}
        </ul>
      )}
      {typeChanged && (
        <p className="muted value-editor__range" role="status">
          Changes the datatype from {datatypeLabel(from)} to {datatypeLabel(chosen)}.
        </p>
      )}
      {numberText && !typeChanged && <p className="muted value-editor__range">{NUMBER_TEXT_HINT}</p>}
      {range && <p className="muted value-editor__range">{range}</p>}
      {hints.data?.hintType === 'none' && hints.data.detail && <p className="muted value-editor__range">No suggestions: {hints.data.detail}</p>}
      {unitChanged && chosenUnit !== '' && (
        <p className="muted value-editor__range" role="status">
          {chosenUnit ? `Changes the unit to ${chosenUnit}.` : 'Removes the unit.'}
        </p>
      )}
      {error && (error.kind === 'invalid' || error.kind === 'datatype' || error.kind === 'unit') ? (
        <div id={ids.error} className="value-editor__warning" role="alert">
          <p className="form-error">Not saved: {shortenText(error.message)}</p>
          <p className="muted">
            {error.kind === 'datatype'
              ? `You can save it anyway, as a value declared ${datatypeLabel(chosen)}, for example to test how alerts and the system react to a value not of its datatype.`
              : error.kind === 'unit'
                ? 'You can save it anyway, for example to test how the system reacts to a unit it doesn’t expect.'
                : 'You can save it anyway, for example to test how alerts and the system react to a wrong value.'}
          </p>
          <Button size="sm" variant="danger" disabled={busy} onClick={() => (error.kind === 'unit' ? save(valueInsisted, true) : save(true, unitInsisted))}>Save anyway</Button>
        </div>
      ) : error && <p id={ids.error} className="form-error value-editor__error" role="alert">Not saved: {shortenText(error.message)}</p>}
    </div>
  )
}
