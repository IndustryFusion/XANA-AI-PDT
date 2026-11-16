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
import { entityLabel } from '../../app/EntityRef'
import { entities } from '../../data'
import { formatTime } from '../../ui/format'
import { useContextMenu } from '../../ui/ContextMenu'
import { Icon, IconButton } from '../../ui/icons'
import {
  attributeKind, datatypeLabel, editableValue, effectiveDatatype, fitsDatatype, hasHistory, instancesOf, iriOf, isNumberText, kindInfo, literalOf, parseInput, subAttributesOf, targetsOf, timeSeriesAhead, valueOfDatatype,
} from './attributes'
import AttributeValue from './AttributeValue'
import AddAttributeForm from './AddAttributeForm'
import HistoryPane from './HistoryPane'
import { Iri, nameItems, useCopy, useFullIri, useRegistry } from './Iri'
import { isHttpIri, registry } from './prefixes'
import { useKept, useUnnested } from './store'
import ValueEditor, { NUMBER_TEXT_HINT } from './ValueEditor'

/** Deepest nesting of relationship targets expanded in place. */
export const MAX_DEPTH = 5

/** Kind label, tinted per kind; the text is always present. */
export function KindBadge({ kind }) {
  const info = kindInfo(kind)
  return <span className={`kind-tag kind-tag--${info.tone}`}>{info.label}</span>
}

const Space = () => ' '

/** Whether a level's name is the one a link gives: the same, or with a dataset index such as `[0]` after it. */
const sameLevel = (own, given) => own === given || given.replace(/\[\d*\]$/, '') === own

/** How a line stands to the focused path: `'line'` (it is the line), `'above'` (a level above it) or null. */
export function focusOf(focus, levels) {
  if (!focus || focus.length < levels.length || !levels.every((l, i) => sameLevel(l, focus[i]))) return null
  return focus.length === levels.length ? 'line' : 'above'
}

const AHEAD = {
  newer: 'The time series holds a more recent value than the one shown. Alerts check the latest value, so this one may mislead; see the history.',
  deleted: 'This attribute is in the broker, but the time series records it as deleted. Alerts no longer see it; see the history.',
}

/** A small attention mark beside a value the time series is ahead of; its tooltip says what is wrong. */
function TimeSeriesAhead({ ahead }) {
  const text = AHEAD[ahead]
  return <span className="attr-line__behind" role="img" tabIndex={0} title={text} aria-label={text}>⚠</span>
}

/** A dataset ID as it is shown after an attribute's name, in brackets: short when it is an IRI. */
export const datasetLabel = (id) => (isHttpIri(id) ? registry.shorten(id) : entityLabel(id))

/** `name.sub.sub2`, only to mark lines in the page; IRIs contain dots, so keys use `levelKey`. */
export const dotted = (name, path = []) => [name, ...path].join('.')
/** A key for a level that no name can make ambiguous: the levels as a JSON array. */
export const levelKey = (name, path = []) => JSON.stringify([name, ...path])
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
/**
 * One line of an attribute or a sub-attribute. `dataset` is the dataset of the attribute's instance the line
 * belongs to, so every edit goes to that instance. `first` marks the first instance, which carries what
 * applies to the attribute as a whole: its history and deleting it.
 */
function Line({ name, path, inst, ctx, actions, multi = false, dataset = null, first = true }) {
  useRegistry()
  const key = `${ctx.nodeKey}#${levelKey(name, path)}`
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
  // In accessible names the dataset tells instances apart; a lone instance keeps its plain name there.
  const instanceName = dataset && multi ? `${registry.shorten(name)}[${datasetLabel(dataset)}]` : registry.shorten(name)
  const label = path.length ? `sub-attribute ${shortDotted(own)} of ${[instanceName, ...path.slice(0, -1).map((level) => shortDotted(level))].join('.')}` : instanceName
  const readOnly = ctx.readOnly
  const editable = actions && !readOnly && editableValue(inst)
  const subs = subAttributesOf(inst)
  const changed = path.length === 0 && ctx.changed
  const pathKey = levelKey(name, path)
  const historyOpen = ctx.historyOf === pathKey
  const focused = focusOf(ctx.focus, [name, ...path])
  // The time series is the reference for alerts: say when it is ahead of the instance shown.
  const ahead = path.length === 0 ? timeSeriesAhead(ctx.stored, inst) : null

  // A level above the focused line opens its sub-attributes; the line itself comes into view.
  useEffect(() => {
    if (focused === 'above') setSubsOpen(true)
    // After the entity's own scroll and the explorer's kept scroll, which run later in this commit or the next frame.
    if (focused !== 'line') return undefined
    const frame = requestAnimationFrame(() => lineRef.current?.scrollIntoView?.({ block: 'center' }))
    return () => cancelAnimationFrame(frame)
  }, [focused, setSubsOpen])
  const iriMember = editable && (editable[0] === 'object' || editable[0] === 'vocab' || (editable[0] === 'value' && kind === 'iri'))

  const menu = useContextMenu({
    label: `Actions for ${label}`,
    items: () => [...nameItems(own, { copy, showFull }), { label: 'Copy value', onSelect: () => copy(valueText(inst), 'the value') }],
  })

  /**
   * Saves into the line's instance. `datatype` is the datatype chosen for the value: the value is written
   * in that datatype's form, exactly (plain or declared), and a datatype other than the stored one is a
   * deliberate change, so the backend's number check is skipped for it. `force` writes a value the checks
   * refuse, when the operator insists -- one not of its datatype then goes declared as it was entered.
   */
  async function save(text, { force = false, datatype: chosen = null, from = datatype } = {}) {
    const [member] = editable
    const typed = iriMember ? registry.expand(text, { identifier: true }) : text
    // Parsed against the plain value: a declared number is edited as a number (gh-84).
    let value = parseInput(typed, literalOf(inst[member]), member)
    let exact = false
    if (chosen) {
      // `from` is the datatype the editing started from: a live update meanwhile is no change by the operator.
      const changed = chosen !== from
      // A plain number's datatype is JSON-LD's reading of it, not a choice: kept, any number will do.
      const fits = !changed && typeof inst[member] === 'number' ? isNumberText(typed) : fitsDatatype(typed, chosen)
      if (!fits && !force) {
        throw Object.assign(new Error(`“${typed.trim()}” is not a value of ${datatypeLabel(chosen)}.`), { kind: 'datatype' })
      }
      // Another datatype, or a value saved anyway though not of its datatype: written in exactly that form.
      // The same datatype: written as before, a declared value keeping its datatype and a plain one plain.
      if (changed || !fits) {
        value = valueOfDatatype(typed, chosen, { anyway: !fits })
        exact = true
        if (changed) force = true
      }
    }
    const options = { force, ...(exact ? { exact } : {}) }
    if (path.length) await entities.updateAttributes(ctx.entityId, { [name]: { [member]: value } }, { path, datasetId: dataset, ...options })
    else await entities.updateAttributes(ctx.entityId, { [name]: { [member]: value, ...(dataset ? { datasetId: dataset } : {}) } }, options)
    setEditing(false)
    ctx.onSaved([name, ...path])
  }

  const toggleNested = (target) => setNested((list) => (list.includes(target) ? list.filter((t) => t !== target) : [...list, target]))
  const linkValue = kind === 'relationship' || kind === 'iri'
  const [member, current] = editable || []
  // A property's value has a datatype as the platform reads it, shown beside it and chosen when editing.
  const datatype = kind === 'property' ? effectiveDatatype(inst.value) : null
  const numberText = isNumberText(inst.value)
  const raw = member === 'value' && iriOf(inst.value) ? iriOf(inst.value) : current
  const initial = iriMember && typeof raw === 'string' ? registry.shorten(raw) : raw
  const unnested = useUnnested().filter((u) => u.origin?.key === key).map((u) => u.id)

  let value
  if (editing) {
    value = (
      <ValueEditor
        label={path.length ? `${shortDotted(own)} of ${shortDotted(name, path.slice(0, -1))}` : label} initial={initial}
        entityType={ctx.entityType} attribute={own} iri={!!iriMember} datatype={datatype} numberText={numberText}
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
        ref={lineRef} className={`attr-line${changed ? ' attr-line--changed' : ''}${focused === 'line' ? ' attr-line--focused' : ''}${ahead ? ' attr-line--behind' : ''}`}
        style={{ '--depth': path.length }} {...menu.triggerProps}
      >
        <KindBadge kind={kind} /><Space />
        <span className="attr-line__name mono" title={[own !== registry.shorten(own) ? own : null, path.length === 0 && dataset ? `dataset ${dataset}` : null].filter(Boolean).join('\n') || undefined}>
          {registry.shorten(own)}
          {path.length === 0 && dataset && <span className="attr-line__dataset" data-testid="dataset">[{datasetLabel(dataset)}]</span>}
        </span><Space />
        <span className="tok tok--punct" aria-hidden="true">=</span><Space />
        <div className="attr-line__value mono">{value}</div><Space />
        {ahead && <><TimeSeriesAhead ahead={ahead} /><Space /></>}
        {inst.unitCode && !editing && <><span className="attr-line__unit">{inst.unitCode}</span><Space /></>}
        {datatype && !editing && (
          <><span className="attr-line__datatype mono" data-testid="datatype" title={numberText ? NUMBER_TEXT_HINT : 'The datatype the platform reads the value as'}>{datatypeLabel(datatype)}{numberText && ' · number text'}</span><Space /></>
        )}
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
              {first && hasHistory(inst, path.length === 0 && !!ctx.recorded) && (
                <IconButton icon="history" tone="muted" label={`History of ${label}`} aria-pressed={historyOpen} onClick={() => ctx.onHistory(pathKey)} />
              )}
              {editable && !editing && <IconButton icon="edit" tone="muted" label={`Edit ${label}`} onClick={() => setEditing(true)} />}
              {!readOnly && (
                <IconButton icon="addSub" tone="muted" label={`Add sub-attribute to ${label}`} aria-expanded={addingSub} onClick={() => setAddingSub((a) => !a)} />
              )}
              {/* Each instance of a multi-attribute is deleted alone (its last one takes the attribute along);
                  a lone attribute is deleted whole; a sub-attribute in its own instance. */}
              {!ctx.readOnly && (
                <IconButton
                  icon="delete" tone="muted" className="icon-button--danger-hover"
                  label={path.length === 0 && multi ? `Delete the instance ${registry.shorten(name)}[${dataset ? datasetLabel(dataset) : 'default'}]` : `Delete ${label}`}
                  onClick={() => (path.length === 0 && multi ? ctx.onDelete(name, [], null, dataset ?? '@none') : ctx.onDelete(name, path, path.length ? (dataset ?? (multi ? '@none' : null)) : null))}
                />
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
          entityId={ctx.entityId} parent={name} path={path} datasetId={dataset} label={`Add a sub-attribute to ${label}`}
          onCancel={() => setAddingSub(false)}
          onAdded={() => { setAddingSub(false); setSubsOpen(true); ctx.onSaved([name, ...path]) }}
        />
      )}
      {historyOpen && actions && first && (
        <HistoryPane
          entityId={ctx.entityId} name={name} path={path} unit={inst.unitCode} headingLevel={ctx.headingLevel + 1}
          onClose={() => ctx.onHistory(pathKey)}
        />
      )}
      {subsOpen && subs.length > 0 && (
        <ul id={subsId} className="attr-subs" aria-label={`Sub-attributes of ${label}`}>
          {subs.map(([subName, subAttr]) => (
            <li key={subName} data-attribute={dotted(name, [...path, subName])}>
              <Line name={name} path={[...path, subName]} inst={subAttr} ctx={ctx} actions multi={multi} dataset={dataset} first={first} />
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
      {/* Each instance is a line of its own, named with its dataset, and edited in that dataset. */}
      {instances.map((inst, i) => (
        <Line key={inst.datasetId ?? i} name={name} path={[]} inst={inst} ctx={ctx} actions multi={multi} dataset={inst.datasetId ?? null} first={i === 0} />
      ))}
    </li>
  )
}

