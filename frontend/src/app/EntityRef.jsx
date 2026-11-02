import { useEffect, useId, useRef, useState } from 'react'
import { useToast } from '../ui/components'
import { copyText } from '../ui/clipboard'
import { Link, paths } from './router'

/** Short display label for an NGSI-LD identifier: its last segment. */
export function entityLabel(id) {
  const parts = String(id).split(':')
  return parts[parts.length - 1] || id
}

/**
 * Reference to an entity (or IRI) with the standard cross-navigation actions:
 * open in data explorer, copy the identifier, start an incident, show active
 * incidents and history. `to` overrides the explorer URL (e.g. to keep the
 * explorer's query).
 */
export function EntityRef({ id, label, to }) {
  const [open, setOpen] = useState(false)
  const ref = useRef(null)
  const menuId = useId()
  const notify = useToast()
  const text = label ?? entityLabel(id)
  const href = to ?? paths.entity(id)

  useEffect(() => {
    if (!open) return undefined
    const onDown = (e) => { if (!ref.current?.contains(e.target)) setOpen(false) }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [open])

  const close = () => setOpen(false)

  async function copy() {
    close()
    const ok = await copyText(id)
    notify(ok ? `Copied ${id}` : 'Could not copy to the clipboard.', ok ? 'success' : 'danger')
  }

  return (
    <span className="entity-ref" ref={ref} onKeyDown={(e) => { if (e.key === 'Escape') close() }}>
      <Link to={href} className="entity-ref__link" title={id}>{text}</Link>
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
          <li><Link to={href} onClick={close}>Open in data explorer</Link></li>
          <li><button type="button" onClick={copy}>Copy identifier</button></li>
          <li><Link to={paths.newIncident(id)} onClick={close}>Start new incident</Link></li>
          <li><Link to={paths.activeIncidentsFor(id)} onClick={close}>Show active incidents</Link></li>
          <li><Link to={paths.historyFor(id)} onClick={close}>Show incident history</Link></li>
        </ul>
      )}
    </span>
  )
}
