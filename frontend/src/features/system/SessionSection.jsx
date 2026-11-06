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

import { useEffect, useState } from 'react'
import { useSession } from '../../app/session'
import { useData } from '../../data/useData'
import { Button, Card, StatusBadge } from '../../ui/components'

/** The backend renews the token on its own, so the time left is read again regularly. */
const SESSION_READ_MS = 15_000

const clock = (seconds) => `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`

/** The time left on the token, counting down from the last check; checks again when it runs out. */
function TokenCountdown({ reading, onElapsed }) {
  const seconds = reading.tokenExpiresInS
  const [left, setLeft] = useState(seconds)
  useEffect(() => {
    setLeft(seconds)
    const id = setInterval(() => setLeft((s) => Math.max(0, s - 1)), 1000)
    return () => clearInterval(id)
  }, [reading, seconds])
  useEffect(() => {
    if (left === 0) onElapsed()
  }, [left, onElapsed])
  return <><dt>Token</dt><dd data-testid="token-countdown">Renews automatically; {clock(left)} left</dd></>
}

/** Identity provider, signed-in user, session state (active, refreshing, expired) and time left on the token. */
export default function SessionSection() {
  const { session, authEnabled, backendUnreachable, checkIntervalMs } = useSession()
  const auth = useData('session', 'getAuthConfig')
  const refreshMs = checkIntervalMs ? Math.min(checkIntervalMs, SESSION_READ_MS) : 0
  const current = useData('session', 'getSession', [], { enabled: authEnabled, refreshMs })
  const user = current.data?.user ?? session?.user

  let state = 'not_required'
  if (backendUnreachable) state = 'unknown'
  else if (authEnabled) {
    if (current.status === 'loading' && !current.data) state = 'refreshing'
    else if (current.status === 'error') state = 'unknown'
    else state = current.data?.valid ? 'active' : 'expired'
  }

  return (
    <Card
      title="Session"
      className="session-state"
      actions={authEnabled && <Button size="sm" onClick={current.refresh}>Check session</Button>}
    >
      <dl className="details">
        <dt>Identity provider</dt>
        <dd>{auth.data?.provider ?? (auth.status === 'error' ? 'Unknown (could not be loaded)' : '…')}</dd>
        {user && <><dt>User</dt><dd>{user.name} <span className="muted">({user.username})</span></dd></>}
        {user?.email && <><dt>E-mail</dt><dd>{user.email}</dd></>}
        <dt>Session</dt>
        <dd><StatusBadge kind="session" value={state} label={state === 'unknown' ? 'Unknown (check failed)' : undefined} /></dd>
        {state === 'active' && current.data?.tokenExpiresInS != null && (
          <TokenCountdown reading={current.data} onElapsed={current.refresh} />
        )}
      </dl>
      {state === 'expired' && <p className="muted">The session has expired; you will be asked to sign in again.</p>}
    </Card>
  )
}
