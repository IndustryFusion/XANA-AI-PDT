import { useEffect, useId, useRef, useState } from 'react'
import { useData } from '../data/useData'
import { Button, StatusBadge } from '../ui/components'
import { ThemeSelect } from '../ui/theme'
import { Brand } from './Brand'
import { Link, NAV_ITEMS, paths, useRoute } from './router'
import { useSession } from './session'

export const CONNECTION_POLL_MS = 30_000

export default function Header() {
  const { area } = useRoute()
  return (
    <header className="app-header">
      <Link to={paths.dashboard()} className="app-header__brand">
        <Brand />
      </Link>
      <nav className="app-nav" aria-label="Main">
        <ul>
          {NAV_ITEMS.map((item) => (
            <li key={item.area}>
              <Link to={item.path} className="app-nav__link" aria-current={area === item.area ? 'page' : undefined}>
                {item.label}
              </Link>
            </li>
          ))}
        </ul>
      </nav>
      <div className="app-header__tools">
        <DataspaceIndicator />
        <ThemeSelect />
        <UserMenu />
      </div>
    </header>
  )
}

export function DataspaceIndicator({ refreshMs = CONNECTION_POLL_MS }) {
  const result = useData('dataspace', 'getConnection', [], { refreshMs })
  if (result.status === 'error' && !result.data) {
    return <StatusBadge kind="connection" value="unknown" label="Dataspace status unknown" />
  }
  const state = result.data?.state
  if (!state) return null
  return (
    <span className="row dataspace-indicator">
      <StatusBadge kind="connection" value={state} />
      {state === 'expired' && (
        <Link to={paths.dataspace()} className="btn btn--secondary btn--sm">Reconnect</Link>
      )}
    </span>
  )
}

export function UserMenu() {
  const { session, authEnabled, signOut } = useSession()
  const [open, setOpen] = useState(false)
  const ref = useRef(null)
  const panelId = useId()
  const factory = useData('session', 'getFactory', [], { enabled: open })

  useEffect(() => {
    if (!open) return undefined
    const onDown = (e) => { if (!ref.current?.contains(e.target)) setOpen(false) }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [open])

  const user = session?.user
  const name = user?.name ?? 'Operator'

  return (
    <div className="user-menu" ref={ref} onKeyDown={(e) => { if (e.key === 'Escape') setOpen(false) }}>
      <Button size="sm" aria-expanded={open} aria-controls={panelId} onClick={() => setOpen((o) => !o)}>
        <span aria-hidden="true" className="user-menu__avatar">{name.charAt(0)}</span>
        <span className="user-menu__name">{name}</span>
        <span className="visually-hidden">, account and factory details</span>
      </Button>
      {open && (
        <div id={panelId} className="user-menu__panel card">
          <div className="card__body stack">
            <dl className="details">
              {user?.name && <><dt>Name</dt><dd>{user.name}</dd></>}
              {user?.email && <><dt>E-mail</dt><dd>{user.email}</dd></>}
            </dl>
            <FactoryDetails result={factory} fallbackId={session?.factoryId} />
            {authEnabled && <Button onClick={signOut}>Sign out</Button>}
          </div>
        </div>
      )}
    </div>
  )
}

export function FactoryDetails({ result, fallbackId }) {
  const f = result.data
  if (result.status === 'loading' && !f) return <p className="muted">Loading factory details…</p>
  const id = f?.id ?? fallbackId
  const location = f?.location ? [f.location.city, f.location.country].filter(Boolean).join(', ') : null
  if (!id && !f) return null
  return (
    <section aria-label="Factory">
      <h2 className="details__title">Factory</h2>
      <dl className="details">
        {f?.name && <><dt>Name</dt><dd>{f.name}</dd></>}
        {id && <><dt>Identifier</dt><dd className="mono">{id}</dd></>}
        {f?.owner && <><dt>Owner</dt><dd>{f.owner}</dd></>}
        {location && <><dt>Location</dt><dd>{location}</dd></>}
      </dl>
      {result.status === 'error' && <p className="muted">Further factory details are unavailable.</p>}
    </section>
  )
}
