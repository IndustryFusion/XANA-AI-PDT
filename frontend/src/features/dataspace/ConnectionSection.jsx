import { useId, useState } from 'react'
import { dataspace, sourceInfo } from '../../data'
import { useData } from '../../data/useData'
import { Button, Card, DataView, StatusBadge, useToast } from '../../ui/components'
import { formatTime } from '../../ui/format'
import { ConfirmDialog } from '../../ui/structured'

const CONNECT_ERRORS = {
  unauthorized: 'The dataspace rejected the credential. Check it and try again.',
  unavailable: 'The dataspace gateway cannot be reached. Check the gateway in the System area or try again later.',
}

/** Why escalation and peers are unavailable in a state other than connected. */
const UNAVAILABLE = {
  expired: 'The dataspace session has expired. Reconnect to escalate incidents to machine builders and to see peers and requests.',
  disconnected: 'Not connected to the dataspace. Escalation to machine builders, peers and capability requests are unavailable until you connect.',
  not_configured: 'No dataspace connection is configured for this factory, so escalation to machine builders is unavailable. The connection is part of the deployment configuration.',
}

/**
 * Connection state, session expiry and identity, with connect (asking for the
 * credential when the configuration provides none) and disconnect.
 */
export default function ConnectionSection({ result }) {
  return (
    <Card title="Connection" className="dataspace-connection">
      <DataView result={result} errorTitle="Could not load the dataspace connection">
        {(connection) => <ConnectionDetails connection={connection} />}
      </DataView>
    </Card>
  )
}

function ConnectionDetails({ connection }) {
  const factory = useData('session', 'getFactory')
  const [confirming, setConfirming] = useState(false)
  const notify = useToast()
  const { state } = connection

  return (
    <div className="stack">
      <StatusBadge kind="connection" value={state} />
      {state !== 'connected' && <p>{UNAVAILABLE[state]}</p>}
      {state !== 'not_configured' && (
        <dl className="details">
          {state === 'connected' && connection.expiresAt && (
            <><dt>Session valid until</dt><dd><time dateTime={connection.expiresAt}>{formatTime(connection.expiresAt)}</time></dd></>
          )}
          {connection.participantId && <><dt>Participant</dt><dd className="mono">{connection.participantId}</dd></>}
          {factory.data && <><dt>Factory</dt><dd>{factory.data.name} <span className="mono muted">{factory.data.id}</span></dd></>}
        </dl>
      )}
      {state === 'connected' && (
        <div className="row">
          <Button onClick={() => setConfirming(true)}>Disconnect…</Button>
        </div>
      )}
      {(state === 'disconnected' || state === 'expired') && (
        <ConnectForm credentialConfigured={connection.credentialConfigured} reconnect={state === 'expired'} />
      )}
      <ConfirmDialog
        open={confirming}
        title="Disconnect from the dataspace?"
        confirmLabel="Disconnect"
        onClose={() => setConfirming(false)}
        onConfirm={async () => {
          await dataspace.disconnect()
          notify('Disconnected from the dataspace.')
        }}
      >
        <p>While disconnected, incidents cannot be escalated to machine builders, and peers and capability requests are not available.</p>
      </ConfirmDialog>
    </div>
  )
}

function ConnectForm({ credentialConfigured, reconnect }) {
  const [secret, setSecret] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const notify = useToast()
  const secretId = useId()
  const errorId = useId()

  async function submit(e) {
    e.preventDefault()
    if (!credentialConfigured && !secret) {
      setError('Enter the dataspace credential.')
      return
    }
    setBusy(true)
    setError(null)
    try {
      await dataspace.connect(credentialConfigured ? {} : { secret })
      notify('Connected to the dataspace.', 'success')
    } catch (err) {
      setError(CONNECT_ERRORS[err.kind] ?? err.message)
      setBusy(false)
    }
  }

  const label = reconnect ? 'Reconnect' : 'Connect'
  return (
    <form className="stack connect-form" onSubmit={submit} aria-label="Connect to the dataspace" noValidate>
      {credentialConfigured ? (
        <p className="muted">The credential is provided by the configuration.</p>
      ) : (
        <div className="field">
          <label className="field__label" htmlFor={secretId}>Dataspace credential</label>
          <input
            id={secretId} type="password" autoComplete="off" value={secret} disabled={busy}
            aria-invalid={error ? 'true' : undefined} aria-describedby={error ? errorId : undefined}
            onChange={(e) => setSecret(e.target.value)}
          />
          {sourceInfo?.dataspaceHint && <span className="muted connect-form__hint">{sourceInfo.dataspaceHint}</span>}
        </div>
      )}
      {error && <p id={errorId} className="form-error" role="alert">{error}</p>}
      <div className="row">
        <Button type="submit" variant="primary" disabled={busy}>{busy ? 'Connecting…' : label}</Button>
      </div>
    </form>
  )
}
