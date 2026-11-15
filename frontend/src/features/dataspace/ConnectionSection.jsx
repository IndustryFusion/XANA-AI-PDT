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
import { dataspace, sourceInfo } from '../../data'
import { useData } from '../../data/useData'
import { Button, Card, DataView, StatusBadge, useToast } from '../../ui/components'
import { formatTime } from '../../ui/format'
import { ConfirmDialog } from '../../ui/structured'
import SharingTier from './SharingTier'

/** Added to a failed connect's own message, by the step that failed. */
const CONNECT_HINTS = {
  gateway: 'Check the gateway in the System area or try again later.',
}

/** The facts a failed connect reports, in reading order, with their labels. */
const DETAIL_LABELS = [
  ['stage', 'Step'],
  ['url', 'Address'],
  ['client_id', 'Client'],
  ['http_status', 'HTTP status'],
  ['provider_error', 'Identity provider error'],
  ['error', 'Error'],
]
const STAGES = { identity_provider: 'Getting a token from the dataspace’s identity provider', gateway: 'Reaching the dataspace gateway' }

/** Under this many seconds left, the session's countdown is marked as urgent. */
export const URGENT_S = 60

/** `4 min 05 s`, `35 s`; null once nothing is left. */
export function remaining(ms) {
  if (!(ms > 0)) return null
  const s = Math.floor(ms / 1000)
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const rest = String(s % 60).padStart(2, '0')
  if (h) return `${h} h ${String(m).padStart(2, '0')} min`
  return m ? `${m} min ${rest} s` : `${s} s`
}

/** Why escalation and peers are unavailable in a state other than connected. */
const UNAVAILABLE = {
  expired: 'The dataspace session has expired. Reconnect to escalate incidents to machine builders and to see peers and requests.',
  disconnected: 'Not connected to the dataspace. Escalation to machine builders, peers and capability requests are unavailable until you connect.',
  not_configured: 'No dataspace connection is configured for this factory, so escalation to machine builders is unavailable. The connection is part of the deployment configuration.',
}
/** The gateway is set up, but no client is known: it is the company of the signed-in operator. */
const NEEDS_SIGN_IN = 'Sign in to IFF first: the dataspace client is your company, and your sign-in carries none. Until then, connecting, escalation to machine builders, peers and requests are unavailable.'

/**
 * The dataspace gateway in one card, as an overview: the connection state once, the session token with
 * its time left, where the connection goes and for whom, the data-sharing tier, and connect or disconnect.
 */
export default function ConnectionSection({ result }) {
  return (
    <Card title="Dataspace gateway" className="dataspace-connection">
      <DataView result={result} errorTitle="Could not load the dataspace connection">
        {(connection) => <ConnectionDetails connection={connection} onExpired={result.refresh} />}
      </DataView>
    </Card>
  )
}

function ConnectionDetails({ connection, onExpired }) {
  const factory = useData('session', 'getFactory')
  const config = useData('dataspace', 'getConnectionConfig', [], { refreshKey: connection.state })
  const [confirming, setConfirming] = useState(false)
  const notify = useToast()
  const { state } = connection
  const c = config.data

  return (
    <div className="stack gateway">
      <div className="row gateway__head">
        <StatusBadge kind="connection" value={state} />
      </div>
      {state === 'connected' && connection.expiresAt && (
        <TokenBox until={connection.expiresAt} seconds={connection.expiresInS} onElapsed={onExpired} />
      )}
      {state === 'expired' && (
        <div className="token-box token-box--danger">
          <strong>Session expired</strong>
          <span>Reconnect below to escalate incidents and to see peers and requests.</span>
        </div>
      )}
      {state !== 'connected' && state !== 'expired' && <p>{state === 'not_configured' && connection.needsSignIn ? NEEDS_SIGN_IN : UNAVAILABLE[state]}</p>}
      {connection.detail && <p role="status">{connection.detail}</p>}
      <dl className="details gateway__details">
        {c && <><dt>Gateway</dt><dd className="mono">{c.gatewayUrl ?? <span className="muted">Not configured</span>}</dd></>}
        {c && <><dt>Identity provider</dt><dd>{c.keycloakUrl ? <><span className="mono">{c.keycloakUrl}</span> <span className="muted">realm {c.realm}</span></> : <span className="muted">Not configured</span>}</dd></>}
        {(connection.participantId || c?.clientId) && <><dt>Participant</dt><dd className="mono">{connection.participantId ?? c.clientId}</dd></>}
        {factory.data && <><dt>Factory</dt><dd>{factory.data.name} <span className="mono muted">{factory.data.id}</span></dd></>}
        {c && <><dt>IFRIC registry</dt><dd className="mono">{c.registryUrl ?? <span className="muted">Not configured</span>}</dd></>}
      </dl>
      {config.status === 'error' && <p className="form-error" role="alert">Could not load the configuration: {config.error?.message}</p>}
      {state !== 'not_configured' && <SharingTier tier={connection.sharingTier} />}
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

/**
 * The session token: valid (green) with when it expires and the time left, ticking every second,
 * then orange in its last minute. The time left counts down from the seconds the backend gave when
 * it was read, so the browser's clock doesn't matter; once it runs out, the connection is read again,
 * which brings the renewed token. The ticking is not announced: it would speak every second.
 */
function TokenBox({ until, seconds, onElapsed }) {
  // When the backend's seconds were read; a new reading starts the count again.
  const [readAt, setReadAt] = useState(() => Date.now())
  useEffect(() => { setReadAt(Date.now()) }, [seconds, until])
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [])
  const left = seconds != null ? seconds * 1000 - (now - readAt) : Date.parse(until) - now
  const text = remaining(left)
  const urgent = !text || left < URGENT_S * 1000
  const elapsed = !text
  useEffect(() => { if (elapsed) onElapsed?.() }, [elapsed, onElapsed])
  return (
    <div className={`token-box token-box--${urgent ? 'warning' : 'success'}`} data-testid="token-box">
      <strong>{text ? 'Token valid' : 'Token renewing'}</strong>
      <span>
        Expires <time dateTime={until}>{formatTime(until)}</time>
        {text && <> · <span className={`session-countdown${urgent ? ' session-countdown--urgent' : ''}`} data-testid="session-countdown">{text} remaining{urgent ? ', renews shortly' : ''}</span></>}
      </span>
    </div>
  )
}

/** What a failed connect reported, behind a disclosure, for diagnosis. */
function ErrorDetails({ details }) {
  const rows = DETAIL_LABELS.filter(([key]) => details?.[key] != null && details[key] !== '')
  if (!rows.length) return null
  return (
    <details className="connect-form__details">
      <summary>Technical details</summary>
      <dl className="details">
        {rows.map(([key, label]) => (
          <div key={key} className="details__row">
            <dt>{label}</dt>
            <dd className={key === 'url' || key === 'client_id' ? 'mono' : undefined}>{key === 'stage' ? (STAGES[details.stage] ?? details.stage) : String(details[key])}</dd>
          </div>
        ))}
      </dl>
    </details>
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
      setError({ message: 'Enter the dataspace credential.' })
      return
    }
    setBusy(true)
    setError(null)
    try {
      await dataspace.connect(credentialConfigured ? {} : { secret })
      notify('Connected to the dataspace.', 'success')
    } catch (err) {
      setError(err)
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
      {error && (
        <p id={errorId} className="form-error" role="alert">
          {error.message}{error.details?.stage && CONNECT_HINTS[error.details.stage] && ` ${CONNECT_HINTS[error.details.stage]}`}
        </p>
      )}
      {error?.details && <ErrorDetails details={error.details} />}
      <div className="row">
        <Button type="submit" variant="primary" disabled={busy}>{busy ? 'Connecting…' : label}</Button>
      </div>
    </form>
  )
}
