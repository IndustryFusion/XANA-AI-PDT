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

import { useEffect, useId, useState } from 'react'
import { Button, useToast } from '../../ui/components'
import { copyText } from '../../ui/clipboard'
import { entityText, parseEntityText, planChanges } from './rawEdit'

/**
 * The entity as editable JSON. Save applies the difference to the entity as
 * it was when editing started; invalid JSON and changes of ID or type are
 * reported and not saved. Read-only in a historical view (copy only).
 */
export default function RawJsonEditor({ entity, readOnly, onApply, onClose }) {
  const [base, setBase] = useState(entity)
  const [text, setText] = useState(() => entityText(entity))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const notify = useToast()
  const ids = { text: useId(), error: useId() }
  const dirty = text !== entityText(base)

  // While nothing is edited, follow changes of the entity (saves, live updates).
  useEffect(() => {
    if (dirty) return
    setBase(entity)
    setText(entityText(entity))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entity])

  async function copy() {
    const ok = await copyText(text)
    notify(ok ? 'Entity JSON copied.' : 'Could not copy to the clipboard.', ok ? 'success' : 'danger')
  }

  async function save() {
    const parsed = parseEntityText(text, base)
    if (parsed.error) { setError(parsed.error); return }
    const steps = planChanges(base, parsed.entity)
    setError(null)
    if (steps.length === 0) {
      setText(entityText(base))
      notify('No attribute was changed.', 'success')
      return
    }
    setBusy(true)
    try {
      await onApply(steps)
      setBase(parsed.entity)
      setText(entityText(parsed.entity))
    } catch (err) {
      setError(`Not all changes were saved: ${err.message}`)
    } finally {
      setBusy(false)
    }
  }

  function cancel() {
    setText(entityText(base))
    setError(null)
    onClose()
  }

  return (
    <div className="raw-editor stack">
      <label className="visually-hidden" htmlFor={ids.text}>Entity JSON</label>
      <textarea
        id={ids.text} className="raw-json mono" value={text} readOnly={readOnly || busy} spellCheck={false}
        rows={Math.min(Math.max(text.split('\n').length, 6), 30)}
        aria-invalid={error ? true : undefined} aria-describedby={error ? ids.error : undefined}
        onChange={(e) => { setText(e.target.value); setError(null) }}
      />
      {error && <p id={ids.error} className="form-error" role="alert">{error}</p>}
      <div className="row">
        <Button size="sm" onClick={copy}>Copy JSON</Button>
        {!readOnly && (
          <>
            <Button size="sm" variant="primary" onClick={save} disabled={!dirty || busy}>{busy ? 'Saving…' : 'Save JSON'}</Button>
            <Button size="sm" onClick={cancel} disabled={busy}>Cancel</Button>
          </>
        )}
      </div>
    </div>
  )
}
