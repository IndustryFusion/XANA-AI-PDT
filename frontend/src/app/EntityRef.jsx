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

import { useEffect, useId, useRef, useState } from 'react'
import { useToast } from '../ui/components'
import { copyText } from '../ui/clipboard'
import { useContextMenu } from '../ui/ContextMenu'
import { Link, paths, useRoute } from './router'

/** Short display label for an NGSI-LD identifier: its last segment. */
export function entityLabel(id) {
  const parts = String(id).split(':')
  return parts[parts.length - 1] || id
}

/**
 * The standard cross-navigation actions for an entity, as context-menu items:
 * open in the data explorer, start an incident, show active incidents and
 * incident history. `href` overrides the explorer URL.
 */
export function entityMenuItems(id, navigate, href = paths.entity(id)) {
  return [
    { label: 'Open in data explorer', onSelect: () => navigate(href) },
    { label: 'Start new incident', onSelect: () => navigate(paths.newIncident(id)) },
    { label: 'Show active incidents', onSelect: () => navigate(paths.activeIncidentsFor(id)) },
    { label: 'Show incident history', onSelect: () => navigate(paths.historyFor(id)) },
  ]
}

/**
 * The reference as a link whose actions are in a context menu (right-click,
 * Shift+F10, the menu key or a long press) instead of a button. `items` come
 * before the cross-navigation actions; `title` is the link's tooltip.
 */
function ContextEntityRef({ id, text, href, items = [], title, className = '' }) {
  const { navigate } = useRoute()
  const menu = useContextMenu({
    label: `Actions for ${text}`,
    items: () => [...items, ...(items.length ? [{ separator: true }] : []), ...entityMenuItems(id, navigate, href)],
  })
  return (
    <span className={`entity-ref entity-ref--context${className ? ` ${className}` : ''}`}>
      <Link to={href} className="entity-ref__link" title={title ?? id} {...menu.triggerProps}>{text}</Link>
      {menu.menu}
    </span>
  )
}

/**
 * Reference to an entity (or IRI) with the standard cross-navigation actions:
 * open in data explorer, copy the identifier, start an incident, show active
 * incidents and history. `to` overrides the explorer URL (e.g. to keep the
 * explorer's query). With `menu="context"` the actions are in a context menu,
 * with `items` before them, instead of behind a button.
 */
export function EntityRef({ id, label, to, menu, items, title, className }) {
  if (menu === 'context') {
    return <ContextEntityRef id={id} text={label ?? entityLabel(id)} href={to ?? paths.entity(id)} items={items} title={title} className={className} />
  }
  return <ButtonEntityRef id={id} label={label} to={to} />
}

function ButtonEntityRef({ id, label, to }) {
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
