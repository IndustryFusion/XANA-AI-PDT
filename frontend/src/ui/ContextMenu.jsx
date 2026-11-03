import { useEffect, useLayoutEffect, useRef, useState } from 'react'

const MARGIN = 4

/**
 * Menu shown at a point: where the pointer was right-clicked, or under the
 * element it was opened from with the keyboard. Arrow keys, Home and End
 * move between items; Escape, Tab, a click outside or resizing the window
 * close it, and focus returns to where it was. It is fixed-positioned, so
 * render it anywhere inside the page's landmarks.
 *
 *   items: [{ label, onSelect, primary? } | { separator: true }]
 */
export function ContextMenu({ at, label, items, onClose }) {
  const ref = useRef(null)
  const returnTo = useRef(null)
  const [pos, setPos] = useState(at)

  useLayoutEffect(() => {
    returnTo.current = document.activeElement
    const { width, height } = ref.current.getBoundingClientRect()
    setPos({
      x: Math.max(MARGIN, Math.min(at.x, window.innerWidth - width - MARGIN)),
      y: Math.max(MARGIN, Math.min(at.y, window.innerHeight - height - MARGIN)),
    })
    ref.current.querySelector('[role="menuitem"]')?.focus({ preventScroll: true })
    return () => { if (returnTo.current?.isConnected) returnTo.current.focus({ preventScroll: true }) }
  }, [at])

  useEffect(() => {
    const onDown = (e) => { if (!ref.current?.contains(e.target)) onClose() }
    document.addEventListener('mousedown', onDown)
    window.addEventListener('resize', onClose)
    return () => {
      document.removeEventListener('mousedown', onDown)
      window.removeEventListener('resize', onClose)
    }
  }, [onClose])

  function onKeyDown(e) {
    const entries = [...ref.current.querySelectorAll('[role="menuitem"]')]
    const index = entries.indexOf(document.activeElement)
    const move = { ArrowDown: index + 1, ArrowUp: index - 1, Home: 0, End: entries.length - 1 }[e.key]
    if (move !== undefined) {
      e.preventDefault()
      entries[(move + entries.length) % entries.length]?.focus({ preventScroll: true })
    } else if (e.key === 'Escape' || e.key === 'Tab') {
      e.preventDefault()
      onClose()
    }
  }

  return (
    <ul
      ref={ref} role="menu" aria-label={label} className="context-menu card"
      style={{ left: pos.x, top: pos.y }} onKeyDown={onKeyDown}
      onContextMenu={(e) => e.preventDefault()}
    >
      {items.map((item, i) => (item.separator
        ? <li key={`separator-${i}`} role="separator" className="context-menu__separator" />
        : (
          <li key={item.label} role="none">
            <button
              type="button" role="menuitem" tabIndex={-1}
              className={`context-menu__item${item.primary ? ' context-menu__item--primary' : ''}`}
              onClick={() => { onClose(); item.onSelect() }}
            >
              {item.label}
            </button>
          </li>
        )))}
    </ul>
  )
}

/** Where to open a menu for a keyboard user: under the given element. */
export function menuPointFor(element) {
  const rect = element.getBoundingClientRect()
  return { x: rect.left, y: rect.bottom + MARGIN }
}

/** The keys that open a context menu from the keyboard: the menu key and Shift+F10. */
export const isMenuKey = (e) => e.key === 'ContextMenu' || (e.shiftKey && e.key === 'F10')
