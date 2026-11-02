import { useSession } from '../../app/session'
import { useData } from '../../data/useData'
import { Button, Card, StatusBadge } from '../../ui/components'

/** Identity provider, signed-in user and session state (active, refreshing, expired). */
export default function SessionSection() {
  const { session, authEnabled } = useSession()
  const auth = useData('session', 'getAuthConfig')
  const current = useData('session', 'getSession', [], { enabled: authEnabled })
  const user = current.data?.user ?? session?.user

  let state = 'not_required'
  if (authEnabled) {
    if (current.status === 'loading') state = 'refreshing'
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
      </dl>
      {state === 'expired' && <p className="muted">The session has expired; you will be asked to sign in again.</p>}
    </Card>
  )
}
