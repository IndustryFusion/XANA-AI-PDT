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

import { forwardRef, useEffect, useLayoutEffect, useRef, useState } from 'react'

/**
 * The UI's icon set: 16 px glyphs drawn with `currentColor` strokes, so they
 * follow the theme and the contrast rules. Each entry is the SVG content of a
 * 16 × 16 view box.
 */
const GLYPHS = {
  history: <><path d="M2.5 8a5.5 5.5 0 1 0 1.6-3.9" /><path d="M2.5 2.5v2.5H5" /><path d="M8 5v3l2 1.5" /></>,
  edit: <><path d="M10.5 2.5l3 3L6 13H3v-3z" /><path d="M9 4l3 3" /></>,
  add: <><path d="M8 3v10" /><path d="M3 8h10" /></>,
  addSub: <><path d="M3 3v7h4" /><path d="M11 7v6" /><path d="M8 10h6" /></>,
  delete: <><path d="M3 4.5h10" /><path d="M6.5 4.5V3h3v1.5" /><path d="M4.5 4.5l.7 8.5h5.6l.7-8.5" /></>,
  json: <><path d="M5.5 2.5c-1.5 0-2 .7-2 2v1.5c0 1-.5 2-1.5 2 1 0 1.5 1 1.5 2v1.5c0 1.3.5 2 2 2" /><path d="M10.5 2.5c1.5 0 2 .7 2 2v1.5c0 1 .5 2 1.5 2-1 0-1.5 1-1.5 2v1.5c0 1.3-.5 2-2 2" /></>,
  pin: <><path d="M6 2.5h4l-.5 4 2 2v1H4.5v-1l2-2z" /><path d="M8 9.5V14" /></>,
  pinned: <><path d="M6 2.5h4l-.5 4 2 2v1H4.5v-1l2-2z" fill="currentColor" /><path d="M8 9.5V14" /></>,
  unnest: <><path d="M3 13V6h7" /><path d="M8 3.5L10.5 6 8 8.5" /><path d="M13 3v10" /></>,
  renest: <><path d="M13 3v7H6" /><path d="M8 12.5L5.5 10 8 7.5" /><path d="M3 3v10" /></>,
  chevronRight: <path d="M6 3.5L10.5 8 6 12.5" />,
  chevronDown: <path d="M3.5 6L8 10.5 12.5 6" />,
  expand: <><path d="M2.5 6V2.5H6" /><path d="M10 13.5h3.5V10" /><path d="M2.5 2.5L7 7" /><path d="M13.5 13.5L9 9" /></>,
  collapse: <><path d="M7 3.5V7H3.5" /><path d="M9 12.5V9h3.5" /><path d="M2.5 2.5L7 7" /><path d="M13.5 13.5L9 9" /></>,
  close: <><path d="M4 4l8 8" /><path d="M12 4l-8 8" /></>,
  copy: <><rect x="5.5" y="5.5" width="8" height="8" rx="1" /><path d="M10.5 5.5v-2a1 1 0 0 0-1-1h-6a1 1 0 0 0-1 1v6a1 1 0 0 0 1 1h2" /></>,
  save: <path d="M3 8.5l3.5 3.5L13 4.5" />,
  cancel: <><path d="M4 4l8 8" /><path d="M12 4l-8 8" /></>,
  link: <><path d="M7 9a3 3 0 0 0 4.2 0l2-2a3 3 0 0 0-4.2-4.2l-.7.7" /><path d="M9 7a3 3 0 0 0-4.2 0l-2 2a3 3 0 0 0 4.2 4.2l.7-.7" /></>,
  goTo: <><path d="M3 8h9" /><path d="M8.5 4.5L12 8l-3.5 3.5" /></>,
  more: <><circle cx="3.5" cy="8" r="1" fill="currentColor" /><circle cx="8" cy="8" r="1" fill="currentColor" /><circle cx="12.5" cy="8" r="1" fill="currentColor" /></>,
  filter: <path d="M2.5 3h11L9.5 8v4.5l-3 1V8z" />,
  search: <><circle cx="7" cy="7" r="4.5" /><path d="M10.5 10.5L13.5 13.5" /></>,
}

export const ICON_NAMES = Object.keys(GLYPHS)

/** One glyph of the icon set; decorative, so hidden from assistive technology. */
export function Icon({ name, className = '' }) {
  return (
    <svg
      className={`icon${className ? ` ${className}` : ''}`} viewBox="0 0 16 16" width="16" height="16"
      fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"
      aria-hidden="true" focusable="false" data-icon={name}
    >
      {GLYPHS[name]}
    </svg>
  )
}

/**
 * A button that shows only an icon. `label` is its accessible name and its
 * tooltip, so the action is named both to assistive technology and on hover.
 * `tone="muted"` is for row actions: visible at all times, full contrast on
 * hover and focus.
 */
export const IconButton = forwardRef(function IconButton(
  { icon, label, tooltip, tone = 'default', className = '', type = 'button', ...props }, ref,
) {
  return (
    <button
      ref={ref} type={type} aria-label={label} title={tooltip ?? label}
      className={`icon-button icon-button--${tone}${className ? ` ${className}` : ''}`} {...props}
    >
      <Icon name={icon} />
    </button>
  )
})

const MARGIN = 4

/**
 * A small box shown next to an element until it is dismissed: Escape or a
 * click outside closes it, and focus returns to where it was. It is
 * fixed-positioned under `anchor`, so render it anywhere.
 */
export function Popover({ anchor, label, onClose, children }) {
  const ref = useRef(null)
  const returnTo = useRef(null)
  const [pos, setPos] = useState({ x: 0, y: 0 })

  useLayoutEffect(() => {
    returnTo.current = document.activeElement
    const rect = anchor?.getBoundingClientRect?.() ?? { left: 0, bottom: 0 }
    const { width, height } = ref.current.getBoundingClientRect()
    setPos({
      x: Math.max(MARGIN, Math.min(rect.left, window.innerWidth - width - MARGIN)),
      y: Math.max(MARGIN, Math.min(rect.bottom + MARGIN, window.innerHeight - height - MARGIN)),
    })
    const first = ref.current.querySelector('input, textarea, button, [tabindex]')
    ;(first ?? ref.current).focus({ preventScroll: true })
    first?.select?.()
    return () => {
      const target = anchor?.isConnected ? anchor : returnTo.current
      if (target?.isConnected) target.focus({ preventScroll: true })
    }
  }, [anchor])

  useEffect(() => {
    const onDown = (e) => { if (!ref.current?.contains(e.target)) onClose() }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [onClose])

  return (
    <div
      ref={ref} role="dialog" aria-label={label} className="popover card" tabIndex={-1}
      style={{ left: pos.x, top: pos.y }}
      onKeyDown={(e) => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); onClose() } }}
    >
      {children}
    </div>
  )
}
