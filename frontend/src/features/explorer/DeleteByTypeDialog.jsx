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
import { entities } from '../../data'
import { Button, Dialog } from '../../ui/components'
import { Iri, shortenText } from './Iri'

/**
 * Deletes all entities of the selected types: choose types, confirm, then
 * see the number of deleted entities per type.
 */
export default function DeleteByTypeDialog({ open, types, onClose, onDeleted }) {
  const [selected, setSelected] = useState([])
  const [step, setStep] = useState('select')
  const [results, setResults] = useState(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const legendId = useId()

  useEffect(() => {
    if (!open) return
    setSelected([])
    setStep('select')
    setResults(null)
    setError(null)
  }, [open])

  const toggle = (type) => setSelected((s) => (s.includes(type) ? s.filter((t) => t !== type) : [...s, type]))

  async function remove() {
    setBusy(true)
    setError(null)
    try {
      setResults(await entities.deleteByTypes(selected))
      setStep('done')
      onDeleted()
    } catch (err) {
      setError(err)
    }
    setBusy(false)
  }

  let footer
  if (step === 'select') {
    footer = <><Button onClick={onClose}>Cancel</Button><Button variant="danger" disabled={selected.length === 0} onClick={() => setStep('confirm')}>Delete entities…</Button></>
  } else if (step === 'confirm') {
    footer = <><Button onClick={() => setStep('select')} disabled={busy}>Back</Button><Button variant="danger" onClick={remove} disabled={busy}>{busy ? 'Deleting…' : 'Delete all'}</Button></>
  } else {
    footer = <Button variant="primary" onClick={onClose}>Done</Button>
  }

  return (
    <Dialog open={open} title="Delete entities by type" busy={busy} onClose={onClose} footer={footer}>
      <div className="stack">
        {step === 'select' && (
          <fieldset className="plain-fieldset stack" aria-labelledby={legendId}>
            <legend id={legendId} className="field__label">Entity types to delete</legend>
            {types.length === 0 && <p className="muted">There are no entity types.</p>}
            {types.map((t) => (
              <label key={t} className="row"><input type="checkbox" checked={selected.includes(t)} onChange={() => toggle(t)} /> <Iri value={t} /></label>
            ))}
          </fieldset>
        )}
        {step === 'confirm' && (
          <p>All entities of the types <strong>{selected.map((t, i) => <span key={t}>{i > 0 && ', '}<Iri value={t} /></span>)}</strong> are deleted. This cannot be undone.</p>
        )}
        {step === 'done' && results && (
          <section className="stack" aria-label="Deleted entities">
            <p role="status">Deletion finished.</p>
            <ul className="plain-list">
              {results.map((r) => <li key={r.type}><strong><Iri value={r.type} /></strong>: {r.count} {r.count === 1 ? 'entity' : 'entities'} deleted</li>)}
            </ul>
          </section>
        )}
        {error && <p className="form-error" role="alert">{shortenText(error.message)}</p>}
      </div>
    </Dialog>
  )
}
