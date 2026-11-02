import { useId, useState } from 'react'
import { dataspace } from '../../data'
import { useData } from '../../data/useData'
import { Button, Card, DataView, EmptyState, StatusBadge, useToast } from '../../ui/components'
import { formatTime } from '../../ui/format'
import { ConfirmDialog } from '../../ui/structured'
import { capabilityLabel } from './model'

/** Incoming capability requests with approve and deny (and an optional note). */
export default function CapabilityRequests({ refreshKey, onDecided }) {
  const requests = useData('dataspace', 'listCapabilityRequests', [], { refreshKey })
  const ids = [...new Set((requests.data ?? []).map((r) => r.requesterId))]
  const names = useData('dataspace', 'resolveNames', [ids], { enabled: ids.length > 0 })
  const [pending, setPending] = useState(null)
  const [note, setNote] = useState('')
  const [notice, setNotice] = useState(null)
  const notify = useToast()
  const noteId = useId()
  const nameOf = (id) => names.data?.[id] ?? id

  function open(request, approved) {
    setNote('')
    setNotice(null)
    setPending({ request, approved })
  }

  async function decide() {
    const { request, approved } = pending
    try {
      await dataspace.decideCapabilityRequest(request.id, { approved, note: note.trim() || undefined })
      notify(approved
        ? `Approved: ${nameOf(request.requesterId)} may now access ${capabilityLabel(request.capability).toLowerCase()}.`
        : `Denied the request of ${nameOf(request.requesterId)}.`, 'success')
    } catch (err) {
      if (err.kind !== 'conflict') throw err
      setNotice(`${err.message} No change was made; the list shows the current decision.`)
    }
    onDecided()
  }

  return (
    <Card title="Capability requests" className="capability-requests">
      <div className="stack">
        {notice && <p className="notice" role="status">{notice}</p>}
        <DataView
          result={requests}
          errorTitle="Could not load capability requests"
          isEmpty={(list) => list.length === 0}
          empty={<EmptyState title="No capability requests." />}
        >
          {(list) => (
            <div className="table-wrap">
              <table className="table">
                <caption className="visually-hidden">Incoming capability requests, pending first</caption>
                <thead>
                  <tr>
                    <th scope="col">Requester</th>
                    <th scope="col">Capability</th>
                    <th scope="col">Requested</th>
                    <th scope="col">Status</th>
                    <th scope="col">Decision</th>
                  </tr>
                </thead>
                <tbody>
                  {list.map((r) => (
                    <tr key={r.id} data-request={r.id}>
                      <td>
                        <strong>{nameOf(r.requesterId)}</strong>
                        <span className="mono muted request__id">{r.requesterId}</span>
                        {r.purpose && <span className="request__purpose">{r.purpose}</span>}
                      </td>
                      <td>{capabilityLabel(r.capability)} <span className="mono muted capability-id">{r.capability}</span></td>
                      <td><time dateTime={r.requestedAt}>{formatTime(r.requestedAt)}</time></td>
                      <td><StatusBadge kind="request" value={r.status} /></td>
                      <td>
                        {r.status === 'pending' ? (
                          <div className="row">
                            <Button size="sm" onClick={() => open(r, true)} aria-label={`Approve request ${r.id} of ${nameOf(r.requesterId)}`}>Approve…</Button>
                            <Button size="sm" onClick={() => open(r, false)} aria-label={`Deny request ${r.id} of ${nameOf(r.requesterId)}`}>Deny…</Button>
                          </div>
                        ) : (
                          <span className="request__decision">
                            {r.decidedAt && <time dateTime={r.decidedAt}>{formatTime(r.decidedAt)}</time>}
                            {r.note && <span className="muted">{r.note}</span>}
                          </span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </DataView>
      </div>
      <ConfirmDialog
        open={!!pending}
        title={pending ? `${pending.approved ? 'Approve' : 'Deny'} request ${pending.request.id}` : ''}
        confirmLabel={pending?.approved ? 'Approve' : 'Deny'}
        onClose={() => setPending(null)}
        onConfirm={decide}
      >
        {pending && (
          <>
            <p>
              {nameOf(pending.request.requesterId)} requests <strong>{capabilityLabel(pending.request.capability)}</strong>{' '}
              (<code>{pending.request.capability}</code>).
              {pending.approved && ' Approving grants this capability to the requester.'}
            </p>
            <div className="field">
              <label className="field__label" htmlFor={noteId}>Note (optional)</label>
              <textarea id={noteId} value={note} onChange={(e) => setNote(e.target.value)} />
            </div>
          </>
        )}
      </ConfirmDialog>
    </Card>
  )
}
