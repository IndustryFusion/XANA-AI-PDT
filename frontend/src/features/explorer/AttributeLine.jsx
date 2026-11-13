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

import { useId, useRef, useState } from 'react'
import { entityLabel } from '../../app/EntityRef'
import { entities } from '../../data'
import { formatTime } from '../../ui/format'
import { useContextMenu } from '../../ui/ContextMenu'
import { Icon, IconButton } from '../../ui/icons'
import {
  attributeKind, editableValue, hasHistory, instancesOf, iriOf, kindInfo, parseInput, subAttributesOf, targetsOf,
} from './attributes'
import AttributeValue from './AttributeValue'
import AddAttributeForm from './AddAttributeForm'
import HistoryPane from './HistoryPane'
import { Iri, nameItems, useCopy, useFullIri, useRegistry } from './Iri'
import { isHttpIri, registry } from './prefixes'
import { useKept, useUnnested } from './store'
import ValueEditor from './ValueEditor'

/** Deepest nesting of relationship targets expanded in place. */
export const MAX_DEPTH = 5

/** Kind label, tinted per kind; the text is always present. */
export function KindBadge({ kind }) {
  const info = kindInfo(kind)
  return <span className={`kind-tag kind-tag--${info.tone}`}>{info.label}</span>
}

const Space = () => ' '

/** `name.sub.sub2` for messages and keys. */
export const dotted = (name, path = []) => [name, ...path].join('.')
/** The same, with each level as its short name. */
const shortDotted = (name, path = []) => [name, ...path].map((n) => registry.shorten(n)).join('.')

/**
 * The one expand control of the tree: a chevron with the number of
 * children, the same for entities, attributes and sub-attributes.
 */
export function ExpandControl({ open, count, noun, of, controls, onToggle, className = '' }) {
  return (
    <button
      type="button" className={`expand-control${className ? ` ${className}` : ''}`} aria-expanded={open}
      aria-controls={open ? controls : undefined} onClick={onToggle}
    >
      <Icon name={open ? 'chevronDown' : 'chevronRight'} />
      <span>{count}</span>
      <span className="visually-hidden"> {noun}{count === 1 ? '' : 's'} of {of}</span>
    </button>
  )
}

/**
 * Relationship targets as entity references, each with an icon that expands
 * the target in place, a marker when the target is already shown above in
 * this branch, or a link to it when it was moved out of the tree.
 */
function Targets({ inst, ctx, open, onToggle, origin }) {
  const unnested = useUnnested()
  return (
    <span className="attr-line__targets">
      {targetsOf(inst).map((target) => {
        const short = registry.shorten(target)
        const out = unnested.find((u) => u.id === target && u.origin?.key === origin)
        return (
          <span key={target} className="attr-line__target">
            <Iri value={target} to={ctx.refTo(target)} />
            {out ? (
              <IconButton
                icon="goTo" tone="muted" label={`Go to ${short}, moved out of the tree`}
                onClick={() => ctx.goTo(target)}
              />
            ) : ctx.chain.includes(target) ? (
              <span className="attr-line__marker">shown above</span>
            ) : ctx.depth < MAX_DEPTH ? (
              <IconButton
                icon={open.includes(target) ? 'collapse' : 'expand'} tone="muted" aria-expanded={open.includes(target)}
                label={`Expand ${short} in place`} onClick={() => onToggle(target)}
              />
            ) : (
              <span className="attr-line__marker">nesting limit</span>
            )}
          </span>
        )
      })}
    </span>
  )
}

/** The text of an instance's value, for copying. */
function valueText(inst) {
  const kind = attributeKind(inst)
  const value = kind === 'relationship' ? (inst.object ?? inst.objectList) : kind === 'json' ? inst.json
    : kind === 'language' ? inst.languageMap : kind === 'list' ? inst.valueList : kind === 'vocabulary' ? inst.vocab
      : kind === 'iri' ? iriOf(inst.value) : inst.value
  return typeof value === 'string' ? value : JSON.stringify(value)
}

/**
 * One line of the entity document, at any depth: kind label, name, `=`,
 * value, unit, observation time, the line's icon actions, and its
 * sub-attributes below it as lines of the same kind. `path` names the levels
 * below the top-level attribute `name`; it is empty for the attribute itself.
 * Selecting an editable value edits it in place.
 */
function Line({ name, path, inst, ctx, actions, multi = false }) {
  useRegistry()
  const key = `${ctx.nodeKey}#${dotted(name, path)}`
  const [editing, setEditing] = useState(false)
  const [subsOpen, setSubsOpen] = useKept(`${key}|subs`, false)
  const [nested, setNested] = useKept(`${key}|nested`, [])
  const [addingSub, setAddingSub] = useState(false)
  const subsId = useId()
  const lineRef = useRef(null)
  const copy = useCopy()
  const [showFull, popover] = useFullIri(lineRef)
  const kind = attributeKind(inst)
  const own = path.length ? path.at(-1) : name
  const label = path.length ? `sub-attribute ${shortDotted(own)} of ${shortDotted(name, path.slice(0, -1))}` : registry.shorten(name)
  const readOnly = ctx.readOnly || multi
  const editable = actions && !readOnly && editableValue(inst)
  const subs = subAttributesOf(inst)
  const changed = path.length === 0 && ctx.changed
  const pathKey = dotted(name, path)
  const historyOpen = ctx.historyOf === pathKey
  const iriMember = editable && (editable[0] === 'object' || editable[0] === 'vocab' || (editable[0] === 'value' && kind === 'iri'))

  const menu = useContextMenu({
    label: `Actions for ${label}`,
    items: () => [...nameItems(own, { copy, showFull }), { label: 'Copy value', onSelect: () => copy(valueText(inst), 'the value') }],
  })

  async function save(text) {
    const [member] = editable
    const typed = iriMember ? registry.expand(text, { identifier: true }) : text
    const value = parseInput(typed, inst[member], member)
    if (path.length) await entities.updateAttributes(ctx.entityId, { [name]: { [member]: value } }, { path })
    else await entities.updateAttributes(ctx.entityId, { [name]: { [member]: value } })
    setEditing(false)
    ctx.onSaved(pathKey)
  }

  const toggleNested = (target) => setNested((list) => (list.includes(target) ? list.filter((t) => t !== target) : [...list, target]))
  const linkValue = kind === 'relationship' || kind === 'iri'
  const [member, current] = editable || []
  const raw = member === 'value' && iriOf(inst.value) ? iriOf(inst.value) : current
  const initial = iriMember && typeof raw === 'string' ? registry.shorten(raw) : raw
  const unnested = useUnnested().filter((u) => u.origin?.key === key).map((u) => u.id)

  let value
  if (editing) {
    value = (
      <ValueEditor
        label={path.length ? `${shortDotted(own)} of ${shortDotted(name, path.slice(0, -1))}` : label} initial={initial}
        entityType={ctx.entityType} attribute={own} iri={!!iriMember}
        onSave={save} onCancel={() => setEditing(false)}
      />
    )
  } else if (kind === 'relationship') {
    value = <Targets inst={inst} ctx={ctx} open={nested} onToggle={toggleNested} origin={key} />
  } else if (editable && !linkValue) {
    value = (
      <button type="button" className="attr-line__value-btn" onClick={() => setEditing(true)}>
        <span className="visually-hidden">Value of {label}: </span><AttributeValue attr={inst} refTo={ctx.refTo} />
      </button>
    )
  } else {
    value = <AttributeValue attr={inst} refTo={ctx.refTo} />
  }

  const shownNested = nested.filter((target) => !unnested.includes(target))

  return (
    <>
      <div
        ref={lineRef} className={`attr-line${changed ? ' attr-line--changed' : ''}`}
        style={{ '--depth': path.length }} {...menu.triggerProps}
      >
        <KindBadge kind={kind} /><Space />
        <span className="attr-line__name mono" title={own !== registry.shorten(own) ? own : undefined}>{registry.shorten(own)}</span><Space />
        <span className="tok tok--punct" aria-hidden="true">=</span><Space />
        <div className="attr-line__value mono">{value}</div><Space />
        {inst.unitCode && !editing && <><span className="attr-line__unit">{inst.unitCode}</span><Space /></>}
        {inst.datasetId && <><span className="attr-line__meta" title={inst.datasetId}>dataset {isHttpIri(inst.datasetId) ? registry.shorten(inst.datasetId) : entityLabel(inst.datasetId)}</span><Space /></>}
        {inst.lang && <><span className="attr-line__meta">lang {inst.lang}</span><Space /></>}
        {changed && <><span className="attr-line__changed">Updated</span><Space /></>}
        {subs.length > 0 && (
          <ExpandControl
            open={subsOpen} count={subs.length} noun="sub-attribute" of={label} controls={subsId}
            onToggle={() => setSubsOpen((o) => !o)}
          />
        )}
        <span className="attr-line__end">
          {inst.observedAt && (
            <span className="attr-line__time"><span className="visually-hidden">Observed </span><time dateTime={inst.observedAt}>{formatTime(inst.observedAt)}</time></span>
          )}
          {actions && (
            <span className="attr-line__actions">
              {hasHistory(inst, path.length === 0 && !!ctx.recorded) && (
                <IconButton icon="history" tone="muted" label={`History of ${label}`} aria-pressed={historyOpen} onClick={() => ctx.onHistory(pathKey)} />
              )}
              {editable && !editing && <IconButton icon="edit" tone="muted" label={`Edit ${label}`} onClick={() => setEditing(true)} />}
              {!readOnly && (
                <IconButton icon="addSub" tone="muted" label={`Add sub-attribute to ${label}`} aria-expanded={addingSub} onClick={() => setAddingSub((a) => !a)} />
              )}
              {!ctx.readOnly && (!multi || path.length === 0) && (
                <IconButton icon="delete" tone="muted" className="icon-button--danger-hover" label={`Delete ${label}`} onClick={() => ctx.onDelete(name, path)} />
              )}
            </span>
          )}
        </span>
        {menu.menu}
        {popover}
      </div>
      {shownNested.length > 0 && (
        <div className="attr-line__nested">
          {shownNested.map((target) => <div key={target}>{ctx.renderNested(target, { key, parent: ctx.entityId, attribute: pathKey })}</div>)}
        </div>
      )}
      {addingSub && (
        <AddAttributeForm
          entityId={ctx.entityId} parent={name} path={path} label={`Add a sub-attribute to ${label}`}
          onCancel={() => setAddingSub(false)}
          onAdded={() => { setAddingSub(false); setSubsOpen(true); ctx.onSaved(pathKey) }}
        />
      )}
      {historyOpen && actions && (
        <HistoryPane
          entityId={ctx.entityId} name={name} path={path} unit={inst.unitCode} headingLevel={ctx.headingLevel + 1}
          onClose={() => ctx.onHistory(pathKey)}
        />
      )}
      {subsOpen && subs.length > 0 && (
        <ul id={subsId} className="attr-subs" aria-label={`Sub-attributes of ${label}`}>
          {subs.map(([subName, subAttr]) => (
            <li key={subName} data-attribute={dotted(name, [...path, subName])}>
              <Line name={name} path={[...path, subName]} inst={subAttr} ctx={ctx} actions multi={multi} />
            </li>
          ))}
        </ul>
      )}
    </>
  )
}

/**
 * One attribute of the entity document: a line per instance (several for
 * multi-attributes with dataset IDs), each with its sub-attributes.
 */
export default function AttributeLine({ name, attr, ctx }) {
  const instances = instancesOf(attr)
  const multi = Array.isArray(attr)

  return (
    <li className="attr-item" data-attribute={name}>
      {instances.map((inst, i) => (
        <Line key={inst.datasetId ?? i} name={name} path={[]} inst={inst} ctx={ctx} actions={i === 0} multi={multi} />
      ))}
      {multi && !ctx.readOnly && (
        <div className="attr-line attr-line--note">
          <span className="muted">{instances.length} instances; edit them in the raw JSON.</span>
        </div>
      )}
    </li>
  )
}

