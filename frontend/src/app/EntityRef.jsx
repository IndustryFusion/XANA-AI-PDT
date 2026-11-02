import { useEffect, useId, useRef, useState } from 'react'
import { Link, paths } from './router'

/** Short display label for an NGSI-LD identifier: its last segment. */
export function entityLabel(id) {
  const parts = String(id).split(':')
  return parts[parts.length - 1] || id
}

/**
 * Reference to an entity with the standard cross-navigation actions:
 * open in data explorer, start an incident, show active incidents and history.
 */
export function EntityRef({ id, label }) {
  const [open, setOpen] = useState(false)
  const ref = useRef(null)
  const menuId = useId()
  const text = label ?? entityLabel(id)

  useEffect(() => {
    if (!open) return undefined
    const onDown = (e) => { if (!ref.current?.contains(e.target)) setOpen(false) }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [open])

  const close = () => setOpen(false)

  return (
    <span className="entity-ref" ref={ref} onKeyDown={(e) => { if (e.key === 'Escape') close() }}>
      <Link to={paths.entity(id)} className="entity-ref__link" title={id}>{text}</Link>
      <button
        type="button"
        className="entity-ref__toggle"
        aria-expanded={open}
        aria-controls={menuId}
        aria-label={`Actions for ${text}`}
        onClick={() => setOpen((o) => !o)}
      >
        ▾
      </button>
      {open && (
        <ul id={menuId} className="entity-ref__menu card">
          <li><Link to={paths.entity(id)} onClick={close}>Open in data explorer</Link></li>
          <li><Link to={paths.newIncident(id)} onClick={close}>Start new incident</Link></li>
          <li><Link to={paths.activeIncidentsFor(id)} onClick={close}>Show active incidents</Link></li>
          <li><Link to={paths.historyFor(id)} onClick={close}>Show incident history</Link></li>
        </ul>
      )}
    </span>
  )
}
