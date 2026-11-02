import { useEffect, useState } from 'react'
import { runs } from '../../data'
import { ErrorState, LoadingState } from '../../ui/components'
import { ConfirmDialog } from '../../ui/structured'

/**
 * Escalation pre-flight: shows recipient, data and sharing tier (or why
 * escalation is not possible) and escalates only after confirmation.
 */
export default function EscalationDialog({ open, runId, onClose }) {
  const [check, setCheck] = useState({ status: 'loading' })
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    if (!open) return undefined
    let cancelled = false
    setCheck({ status: 'loading' })
    runs.escalationPreflight(runId).then(
      (data) => { if (!cancelled) setCheck({ status: 'success', data }) },
      (error) => { if (!cancelled) setCheck({ status: 'error', error }) },
    )
    return () => { cancelled = true }
  }, [open, runId, attempt])

  const pre = check.data
  return (
    <ConfirmDialog
      open={open}
      title="Escalate to the machine builder"
      confirmLabel="Escalate"
      cancelLabel={pre && !pre.possible ? 'Close' : 'Cancel'}
      canConfirm={check.status === 'success' && pre.possible}
      onConfirm={() => runs.escalate(runId)}
      onClose={onClose}
    >
      {check.status === 'loading' && <LoadingState label="Checking whether escalation is possible…" />}
      {check.status === 'error' && <ErrorState title="Could not check the escalation" error={check.error} onRetry={() => setAttempt((a) => a + 1)} />}
      {check.status === 'success' && pre.possible && (
        <>
          <dl className="details">
            <dt>Recipient</dt><dd>{pre.recipient.name}</dd>
            <dt>Data-sharing tier</dt><dd>{pre.sharingTier}</dd>
          </dl>
          <div>
            <p className="field__label">Data sent with the escalation</p>
            <ul className="plain-list">{pre.data.map((d) => <li key={d.label}>{d.label}</li>)}</ul>
          </div>
          <p className="muted">Nothing is sent until you confirm. Requests for more data are checked against the tier.</p>
        </>
      )}
      {check.status === 'success' && !pre.possible && (
        <div className="stack">
          <p><strong>Escalation is not possible.</strong></p>
          <p>{pre.reason}</p>
        </div>
      )}
    </ConfirmDialog>
  )
}
