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

/**
 * In-place editor of one value: an input that offers the data model's
 * suggested values as a list (arrow keys move through it, Enter picks one).
 * Enter or ✓ saves, Escape or ✗ cancels. A rejected change keeps the
 * editor open with the entered value and shows the reason.
 */
export default function ValueEditor({ label, initial, entityType, attribute, onSave, onCancel }) {
  const [text, setText] = useState(initial == null ? '' : String(initial))
  const [active, setActive] = useState(-1)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const inputRef = useRef(null)
  const ids = { input: useId(), list: useId(), error: useId() }
  const hints = useData('entities', 'getValueHints', [{ entityType, attribute }])
  const options = (hints.data ?? []).filter((h) => h !== text)

  useEffect(() => { inputRef.current?.focus() }, [])
  useEffect(() => { setActive(-1) }, [text])

  async function save() {
    setBusy(true)
    setError(null)
    try {
      await onSave(text)
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
      if (active >= 0 && options[active] !== undefined) setText(options[active])
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
          onChange={(e) => setText(e.target.value)}
          onKeyDown={onKeyDown}
        />
        <button type="button" className="icon-btn icon-btn--ok" onClick={save} disabled={busy} aria-label={`Save ${label}`} title="Save">✓</button>
        <button type="button" className="icon-btn" onClick={onCancel} disabled={busy} aria-label={`Cancel editing ${label}`} title="Cancel">✗</button>
        {busy && <span className="muted">Saving…</span>}
      </div>
      {listed && (
        <ul id={ids.list} role="listbox" aria-label="Suggested values" className="value-editor__list">
          {options.map((h, i) => (
            <li
              key={h} id={optionId(i)} role="option" aria-selected={i === active}
              className="value-editor__option mono"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => { setText(h); inputRef.current?.focus() }}
            >
              {h}
            </li>
          ))}
        </ul>
      )}
      {error && <p id={ids.error} className="form-error value-editor__error" role="alert">Not saved: {error.message}</p>}
    </div>
  )
}
