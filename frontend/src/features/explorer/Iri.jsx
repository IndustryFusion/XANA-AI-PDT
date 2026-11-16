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

import { useId, useRef, useState, useSyncExternalStore } from 'react'
import { EntityRef } from '../../app/EntityRef'
import { copyText } from '../../ui/clipboard'
import { useContextMenu } from '../../ui/ContextMenu'
import { useToast } from '../../ui/components'
import { Popover } from '../../ui/icons'
import { isHttpIri, registry } from './prefixes'

/** Names whose part after the scheme and namespace (`urn:nid:`) or the prefix (`prefix:`) is longer are shortened. */
export const ABBREVIATE_OVER = 48
const KEEP = 6

/**
 * A long name shortened in the middle, keeping what tells it apart: `urn:uaentity:c3Z1PX…01MDE4`, or
 * `instanceExam:c3Z1PX…01MDE4` for a prefixed name, or `c3Z1PX…01MDE4` for a bare one. Null when the name
 * is short enough to show as it is, and for an http IRI, which is shown by its short name instead.
 */
export function abbreviate(text) {
  const value = String(text ?? '')
  if (isHttpIri(value)) return null
  const lead = /^urn:[^:\s]+:/i.exec(value)?.[0] ?? /^[A-Za-z][\w.-]*:/.exec(value)?.[0] ?? ''
  const rest = value.slice(lead.length)
  if (rest.length <= ABBREVIATE_OVER) return null
  return `${lead}${rest.slice(0, KEEP)}…${rest.slice(-KEEP)}`
}

/** Renders again when the registry's names change (the configured context's prefixes arrived). */
export function useRegistry() {
  useSyncExternalStore(registry.subscribe, () => registry.version)
  return registry
}

/** Copies text and says so. */
export function useCopy() {
  const notify = useToast()
  return async (text, what = text) => {
    const ok = await copyText(text)
    notify(ok ? `Copied ${what}` : 'Could not copy to the clipboard.', ok ? 'success' : 'danger')
  }
}

/** The popover of "Show full IRI": the IRI as selectable text until dismissed. */
export function FullIriPopover({ anchor, iri, onClose }) {
  const id = useId()
  return (
    <Popover anchor={anchor} label="Full IRI" onClose={onClose}>
      <label className="visually-hidden" htmlFor={id}>Full IRI</label>
      <input id={id} className="popover__iri" readOnly value={iri} size={Math.min(80, iri.length + 2)} />
    </Popover>
  )
}

/**
 * The menu items for a name: copy the short name, show and copy the full
 * IRI (only when the name is shown shortened), and copy the value for others.
 * `showFull(iri)` opens the popover.
 */
export function nameItems(value, { copy, showFull }) {
  const short = registry.shorten(value)
  if (!isHttpIri(value)) return [{ label: 'Copy identifier', onSelect: () => copy(value) }]
  return [
    { label: 'Copy short name', onSelect: () => copy(short) },
    { label: 'Show full IRI', onSelect: () => showFull(value) },
    { label: 'Copy full IRI', onSelect: () => copy(value, 'the full IRI') },
  ]
}

/** "Show full IRI" for an element: `[show(iri), popover]`, anchored to `anchorRef`. */
export function useFullIri(anchorRef) {
  const [iri, setIri] = useState(null)
  const popover = iri ? <FullIriPopover anchor={anchorRef.current} iri={iri} onClose={() => setIri(null)} /> : null
  return [setIri, popover]
}

/**
 * An IRI as the explorer shows it: an http(s) IRI as `prefix:local`, or
 * `prefix:` for a namespace, with the full IRI as its tooltip and in its
 * context menu; anything else, such as a URN, as it is. With `to` it is a
 * link to an entity, whose menu also holds the entity's actions.
 */
export function Iri({ value, to, className = '', items = [] }) {
  const reg = useRegistry()
  const copy = useCopy()
  const ref = useRef(null)
  const [showFull, popover] = useFullIri(ref)
  // A long name is shortened in the middle; its menu shows it in full, and abbreviates it again. That
  // holds for the name it was chosen for: another value in the same place is shortened again.
  const [wholeFor, setWholeFor] = useState(null)
  const text = String(value ?? '')
  const parts = reg.parts(text)
  const shown = parts?.text ?? text
  const short = abbreviate(shown)
  const whole = wholeFor === shown
  const visible = short && !whole ? short : shown
  const toggle = short ? [{ label: whole ? 'Abbreviate' : 'Show in full', onSelect: () => setWholeFor(whole ? null : shown) }] : []
  const own = [...toggle, ...nameItems(text, { copy, showFull }), ...items]
  const menu = useContextMenu({ label: `Actions for ${shown}`, items: () => own })
  // The tooltip has the IRI behind a prefixed name, and a shortened name in full above it.
  const title = [short ? shown : null, parts ? text : null].filter(Boolean).join('\n') || undefined

  if (to) {
    return (
      <span ref={ref} className={`iri${className ? ` ${className}` : ''}`}>
        <EntityRef id={text} label={visible} to={to} menu="context" items={own} title={title ?? text} />
        {popover}
      </span>
    )
  }
  return (
    <span
      ref={ref} className={`iri${className ? ` ${className}` : ''}`} title={title}
      tabIndex={0} {...menu.triggerProps}
    >
      {visible}
      {menu.menu}
      {popover}
    </span>
  )
}

/** Text with every http(s) IRI in it shortened, such as a message from the broker. */
export function shortenText(text) {
  return String(text ?? '').replace(/https?:\/\/[^\s"'<>),]+/gi, (iri) => registry.shorten(iri))
}
