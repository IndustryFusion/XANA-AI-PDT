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
import { alerts as alertsApi } from '../../data'
import { Button, Dialog } from '../../ui/components'
import { actionInfo } from './model'

/**
 * Applies one action to one or more alerts with an optional note. The
 * interface has no bulk operation, so the action is applied to each alert in
 * parallel; `onDone` receives the result per alert.
 */
export default function AlertActionDialog({ open, action, ids, onClose, onDone }) {
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const noteId = useId()
  const info = action ? actionInfo(action) : null

  useEffect(() => { if (open) setNote('') }, [open])

  async function apply() {
    setBusy(true)
    const settled = await Promise.allSettled(ids.map((id) => alertsApi.applyAlertAction(id, { action, text: note.trim() || undefined })))
    const results = settled.map((s, i) => (s.status === 'fulfilled'
      ? { id: ids[i], ok: true, status: s.value.status }
      : { id: ids[i], ok: false, reason: s.reason?.message ?? 'The action failed.' }))
    setBusy(false)
    onDone({ action, results })
    onClose()
  }

  if (!info) return null
  const what = ids.length === 1 ? `alert ${ids[0]}` : `${ids.length} alerts`
  return (
    <Dialog
      open={open}
      title={`${info.label} ${what}`}
      busy={busy}
      onClose={onClose}
      footer={(
        <>
          <Button onClick={onClose} disabled={busy}>Cancel</Button>
          <Button variant="primary" onClick={apply} disabled={busy}>{busy ? 'Working…' : info.label}</Button>
        </>
      )}
    >
      <div className="stack">
        {ids.length > 1 && <p>The action is applied to each selected alert; the result is reported per alert.</p>}
        <div className="field">
          <label className="field__label" htmlFor={noteId}>Note (optional)</label>
          <textarea id={noteId} value={note} onChange={(e) => setNote(e.target.value)} disabled={busy} />
        </div>
      </div>
    </Dialog>
  )
}
