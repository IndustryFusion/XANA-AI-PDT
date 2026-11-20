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
import { entityLabel, entityMenuItems } from '../../app/EntityRef'
import { headerOffset } from '../../app/reveal'
import { useRoute } from '../../app/router'
import { entities } from '../../data'
import { useData } from '../../data/useData'
import { Button, useToast } from '../../ui/components'
import { useContextMenu } from '../../ui/ContextMenu'
import { Icon, IconButton } from '../../ui/icons'
import { ConfirmDialog } from '../../ui/structured'
import { attributesOf, displayName, sameValue, statusOf } from './attributes'
import AttributeLine, { datasetLabel } from './AttributeLine'
import AddAttributeForm from './AddAttributeForm'
import { abbreviate, Iri, nameItems, shortenText, useCopy, useFullIri, useRegistry } from './Iri'
import { isHttpIri, registry } from './prefixes'
import { entityPath, readFocus } from './query'
import { applyChanges } from './rawEdit'
import RawJsonEditor from './RawJsonEditor'
import { collapseAll, collapseNested, expandAllRelationships, takeLine, useExpandingAll, pin, renest, toggleSelected, unnest, unpin, useKept, usePins, useSelection } from './store'

/** The time series records a change asynchronously; its state is read again at these delays after it. */
export const STATUS_RECHECK_MS = [2000, 6000]
/** How long a live-updated value stays highlighted. */
export const HIGHLIGHT_MS = 3000
/** Number of depth tints the nested nodes cycle through. */
const TINTS = 5

const count = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`

/** The title of an entity: its name, or its ID as the explorer shows IDs. */
/** What an entity without a name is called: its ID's short name, or its last segment. */
const unnamedTitle = (id) => (isHttpIri(id) ? registry.shorten(id) : entityLabel(id))
// A long one, such as an OPC UA node's, is shortened in the middle; the ID is then the heading's tooltip.
export const entityTitle = (entity, id) => (entity && displayName(entity)) ?? (abbreviate(unnamedTitle(id)) ?? unnamedTitle(id))
/** Whether the entity's title is its ID shortened in the middle. */
export const entityTitleShortened = (entity, id) => !(entity && displayName(entity)) && abbreviate(unnamedTitle(id)) !== null

/** Moves focus to an entity shown on its own (unnested or pinned) and brings it into view. */
export function goToEntity(id) {
  const target = document.querySelector(`[data-own-place="${CSS.escape(id)}"]`)
  if (target) window.scrollBy?.({ top: target.getBoundingClientRect().top - headerOffset() })
  target?.querySelector('.entity-node__toggle')?.focus()
}

/**
 * One entity as a collapsible node of the document tree. The header carries
 * the name, type, attribute count and the node's icon actions; the expanded
 * body lists the attributes in the entity's own order, or the editable raw
 * JSON. Relationship targets expand as nested nodes (`depth` > 0) whose
 * `chain` holds the entities shown above them, so a cycle is marked, not
 * expanded.
 *
 * `place` is where the node is: `top` (a result), `nested` (expanded in place
 * under the relationship `origin`), `unnested` (moved out of the tree) or
 * `pinned`. Nested nodes offer no delete and no raw JSON; they can be
 * unnested. `nodeKey` names the node's place, so its view state is kept.
 *
 * `expanded` and `onExpandedChange` control the node; otherwise it keeps it
 * itself. `summary` is the entity from the result list, shown until the node
 * has loaded its own copy.
 */
/** `name[dataset]`, or `name[default]` for the default instance (`@none`). */
const instanceText = (name, dataset) => `${registry.shorten(name)}[${dataset === '@none' ? 'default' : datasetLabel(dataset)}]`

export default function EntityNode({
  id, summary, depth = 0, chain = [], query, expanded: expandedProp, onExpandedChange,
  current = false, arrived = false, listen, onChanged, onDeleted, standalone = false, refreshKey = 0,
  place = 'top', origin = null, nodeKey = id,
}) {
  useRegistry()
  const { navigate, query: urlQuery } = useRoute()
  const at = query.at || null
  // A link can name an attribute path of the entity it opens; only that node shows it.
  const focus = current ? readFocus(urlQuery) : null
  const readOnly = !!at
  const [ownExpanded, setOwnExpanded] = useKept(`${at ?? ''}|${nodeKey}|open`, place !== 'pinned')
  const expanded = expandedProp ?? ownExpanded
  const setExpanded = (next) => (onExpandedChange ? onExpandedChange(next) : setOwnExpanded(next))
  // In a tree whose relationships are all being expanded, an entity folded by hand opens, once per tree: it
  // takes its place when expand all reaches it, open or not, so folding it later sticks.
  const expandingTree = useExpandingAll(nodeKey)
  useEffect(() => {
    if (place === 'nested' && expandingTree && takeLine(nodeKey, `${nodeKey}|node`) && !expanded) setExpanded(true)
  }, [expandingTree]) // eslint-disable-line react-hooks/exhaustive-deps
  const pins = usePins()
  const selection = useSelection()
  const pinned = pins.includes(id)
  const nested = place === 'nested'
  const copy = useCopy()
  const headerRef = useRef(null)
  const [showFull, popover] = useFullIri(headerRef)
  const result = useData('entities', at ? 'queryEntitiesAt' : 'getEntity', at ? [at, { id }] : [id], { enabled: expanded || !summary, refreshKey })
  // The time series' latest state per attribute; read again after a save, once the store has recorded it.
  const [statusKey, setStatusKey] = useState(0)
  const rechecks = useRef([])
  const stopRechecks = () => { rechecks.current.forEach(clearTimeout); rechecks.current = [] }
  useEffect(() => stopRechecks, [])
  /** Read the time series' state again after a change, once it has had time to record it; a new change starts afresh. */
  function recheckStatus() {
    stopRechecks()
    rechecks.current = STATUS_RECHECK_MS.map((ms) => setTimeout(() => setStatusKey((k) => k + 1), ms))
  }
  const states = useData('entities', 'getAttributeStatus', [id], { enabled: expanded && !at, refreshKey: refreshKey + statusKey })
  const [overrides, setOverrides] = useState({})
  const shownRef = useRef(null)
  const [changed, setChanged] = useState({})
  const [raw, setRaw] = useKept(`${query.at ?? ''}|${nodeKey}|raw`, false)
  const [adding, setAdding] = useState(false)
  const [historyOf, setHistoryOf] = useKept(`${query.at ?? ''}|${nodeKey}|history`, null)
  const [deleting, setDeleting] = useState(null)
  const ids = { title: useId(), body: useId() }
  const ref = useRef(null)
  const notify = useToast()

  useEffect(() => { setOverrides({}) }, [result.data])

  // Only an expanded entity shows attributes, so only it listens; that includes one expanded in place.
  useEffect(() => {
    if (!listen || at || !expanded) return undefined
    const timers = new Set()
    let seq = 0
    const stop = listen(id, (attributes) => {
      // The broker sends the whole entity, so only what differs from what is shown counts as changed.
      const shown = shownRef.current ?? {}
      const names = Object.keys(attributes).filter((name) => !sameValue(shown[name], attributes[name]))
      if (names.length === 0) return
      const mark = ++seq
      setOverrides((o) => ({ ...o, ...attributes }))
      setChanged((c) => ({ ...c, ...Object.fromEntries(names.map((n) => [n, mark])) }))
      const timer = setTimeout(() => {
        timers.delete(timer)
        setChanged((c) => Object.fromEntries(Object.entries(c).filter(([n, m]) => !names.includes(n) || m !== mark)))
      }, HIGHLIGHT_MS)
      timers.add(timer)
    })
    return () => {
      stop()
      timers.forEach(clearTimeout)
    }
  }, [listen, id, at, expanded])

  const menu = useContextMenu({
    label: `Actions for ${entityTitle(shownRef.current, id)}`,
    items: () => [...nameItems(id, { copy, showFull }), { separator: true }, ...entityMenuItems(id, navigate, entityPath(id, query))],
  })

  const level = Math.min(3 + depth, 6)
  const Heading = `h${level}`
  const loaded = at ? result.data?.[0] : result.data
  const missing = (result.status === 'error' && result.error?.kind === 'not_found') || (at && result.status === 'success' && !loaded)
  const failed = result.status === 'error' && !missing && !loaded && !summary

  if (missing && standalone) {
    return (
      <section className="entity-node entity-node--missing" data-entity={id} data-own-place={place === 'top' ? undefined : id} aria-labelledby={ids.title} ref={ref}>
        <h3 id={ids.title}>Entity not found</h3>
        <p className="muted">There is no entity <span className="mono" title={isHttpIri(id) ? id : undefined}>{registry.shorten(id)}</span>. Check the ID or query for entities above.</p>
        {pinned && <IconButton icon="pinned" label={`Unpin ${registry.shorten(id)}`} aria-pressed onClick={() => unpin(id)} />}
      </section>
    )
  }
  if ((missing && !summary) || failed) {
    return (
      <div className="entity-node entity-node--problem" data-entity={id} role={failed ? 'alert' : undefined}>
        {missing
          ? <p>Entity <span className="mono" title={isHttpIri(id) ? id : undefined}>{registry.shorten(id)}</span> was not found.</p>
          : <p>Could not load <span className="mono" title={isHttpIri(id) ? id : undefined}>{registry.shorten(id)}</span>: {shortenText(result.error?.message)}</p>}
        {failed && <Button size="sm" onClick={result.retry}>Retry</Button>}
      </div>
    )
  }

  const base = loaded ?? summary
  const entity = base ? { ...base, ...overrides } : null
  shownRef.current = entity
  const title = entityTitle(entity, id)
  const attributes = entity ? attributesOf(entity) : []
  const refTo = (target) => entityPath(target, query)
  const ownChain = [...chain, id]

  function refresh() {
    result.refresh()
    onChanged?.()
  }

  /** `levels`: the attribute and the sub-attributes below it down to what was saved. */
  function saved(levels) {
    notify(`${[].concat(levels).map((n) => registry.shorten(n)).join('.')} saved.`, 'success')
    refresh()
    recheckStatus()
  }

  function openBody(next) {
    if (!expanded) setExpanded(true)
    next()
  }

  async function applyRaw(steps) {
    try {
      await applyChanges(entities, id, steps)
      notify('Entity JSON saved.', 'success')
    } finally {
      refresh()
      recheckStatus()
    }
  }

  async function confirmDelete() {
    if (deleting.entity) {
      await entities.deleteEntity(id)
      notify(`${registry.shorten(id)} deleted.`, 'success')
      if (pinned) unpin(id)
      if (onDeleted) onDeleted()
      else refresh()
      return
    }
    const { name, path, instance } = deleting
    const options = path.length ? { path, datasetId: deleting.datasetId } : instance ? { datasetId: instance } : {}
    await entities.deleteAttribute(id, name, options)
    notify(path.length ? `Sub-attribute ${short(path.at(-1))} of ${shortPath(name, path.slice(0, -1))} deleted.`
      : instance ? `${instanceText(name, instance)} deleted.` : `${short(name)} deleted.`, 'success')
    // The history of what was deleted, or of anything below it, closes.
    const gone = [name, ...path]
    const open = historyOf ? JSON.parse(historyOf) : null
    if (open && gone.every((level, i) => open[i] === level)) setHistoryOf(null)
    refresh()
    recheckStatus()
  }

  const short = (n) => registry.shorten(n)
  const shortPath = (name, path) => [name, ...path].map(short).join('.')
  const deleteTitle = deleting?.entity ? 'Delete this entity?'
    : deleting?.path?.length ? `Delete the sub-attribute ${short(deleting.path.at(-1))}?`
      : deleting?.instance ? `Delete the instance ${instanceText(deleting.name, deleting.instance)}?` : `Delete the attribute ${short(deleting?.name ?? '')}?`

  const renderNested = (target, from) => (
    <EntityNode
      id={target} depth={depth + 1} chain={ownChain} query={query} listen={listen} onChanged={onChanged} refreshKey={refreshKey}
      place="nested" origin={from} nodeKey={`${from.key}>${target}`}
    />
  )

  const lineCtx = (name) => ({
    entityId: id, entityType: entity.type, readOnly, refTo, depth, chain: ownChain, headingLevel: level, nodeKey,
    changed: !!changed[name], historyOf, focus,
    recorded: !!statusOf(states.data, name),
    stored: statusOf(states.data, name),
    onSaved: saved,
    onHistory: (key) => setHistoryOf((h) => (h === key ? null : key)),
    // `instance`: the dataset of one instance to delete alone (`@none` for the default one), at the attribute itself.
    onDelete: (n, path = [], datasetId = null, instance = null) => setDeleting({ name: n, path, datasetId, instance }),
    renderNested,
    goTo: goToEntity,
  })

  let body = null
  if (expanded) {
    if (!entity) body = <p className="muted entity-node__loading" role="status">Loading entity…</p>
    else if (raw) body = <RawJsonEditor entity={entity} readOnly={readOnly} onApply={applyRaw} onClose={() => setRaw(false)} />
    else {
      body = (
        <>
          {attributes.length > 0 ? (
            <ul className="entity-doc" aria-label={`Attributes of ${title}`}>
              {attributes.map(([name, attr]) => <AttributeLine key={name} name={name} attr={attr} ctx={lineCtx(name)} />)}
            </ul>
          ) : <p className="muted">This entity has no attributes.</p>}
          {adding && !readOnly && (
            <AddAttributeForm
              entityId={id} parent={null} label={`Add an attribute to ${title}`}
              onCancel={() => setAdding(false)}
              onAdded={(n) => { setAdding(false); saved(n) }}
            />
          )}
        </>
      )
    }
  }

  const ownPlace = place === 'unnested' || place === 'pinned'
  const canPin = !nested && !readOnly
  const canWhole = !nested

  return (
    <article
      className={`entity-node entity-node--depth-${depth % TINTS}${current ? ' entity-node--current' : ''}${arrived ? ' entity-node--arrived' : ''}${pinned && !nested ? ' entity-node--pinned' : ''}`}
      data-entity={id} data-own-place={ownPlace ? id : undefined} aria-labelledby={ids.title} ref={ref}
    >
      <header className="entity-node__header" ref={headerRef} {...menu.triggerProps}>
        {place === 'pinned' && (
          <input
            type="checkbox" className="entity-node__select" checked={selection.includes(id)} aria-label={`Select ${title}`}
            onChange={(e) => toggleSelected(id, e.target.checked)}
          />
        )}
        <Heading id={ids.title} className="entity-node__title">
          <button
            type="button" className="entity-node__toggle" aria-expanded={expanded}
            aria-controls={expanded ? ids.body : undefined} onClick={() => setExpanded(!expanded)}
          >
            <Icon name={expanded ? 'chevronDown' : 'chevronRight'} className="entity-node__caret" />
            <span title={entityTitleShortened(entity, id) ? id : undefined}>{title}</span>
          </button>
        </Heading>
        {entity && <span className="kind-tag entity-node__type"><Iri value={entity.type} /></span>}
        {entity && <span className="entity-node__count">{count(attributes.length, 'attribute')}</span>}
        {current && <span className="entity-node__selected" data-testid="selected-entity">Selected</span>}
        {pinned && !nested && <span className="entity-node__badge">Pinned</span>}
        <span className="entity-node__id"><Iri value={id} to={refTo(id)} /></span>
        <span className="entity-node__actions">
          {canPin && (
            <IconButton
              icon={pinned ? 'pinned' : 'pin'} tone="muted" aria-pressed={pinned} label={pinned ? `Unpin ${title}` : `Pin ${title}`}
              onClick={() => (pinned ? unpin(id) : pin(id))}
            />
          )}
          {nested && origin && (
            <IconButton icon="unnest" tone="muted" label={`Unnest ${title}`} onClick={() => unnest(id, origin)} />
          )}
          {place === 'unnested' && (
            <IconButton icon="renest" tone="muted" label={`Re-nest ${title}`} onClick={() => renest(id)} />
          )}
          <IconButton icon="expandAll" tone="muted" label={`Expand all relationships of ${title}`} onClick={() => openBody(() => expandAllRelationships(nodeKey, id))} />
          <IconButton icon="collapseAll" tone="muted" label={`Collapse all in ${title}`} onClick={() => (nested && origin ? collapseNested(nodeKey, origin, id) : collapseAll(nodeKey))} />
          {canWhole && (
            <IconButton icon="json" tone="muted" aria-pressed={raw} label={`Raw JSON of ${title}`} onClick={() => openBody(() => setRaw((r) => !r))} />
          )}
          {!readOnly && (
            <IconButton
              icon="add" tone="muted" aria-expanded={adding} label={`Add attribute to ${title}`}
              onClick={() => openBody(() => { setRaw(false); setAdding((a) => !a) })}
            />
          )}
          {!readOnly && canWhole && (
            <IconButton icon="delete" tone="muted" className="icon-button--danger-hover" label={`Delete entity ${title}`} onClick={() => setDeleting({ entity: true })} />
          )}
        </span>
        {menu.menu}
        {popover}
      </header>
      {expanded && <div id={ids.body} className="entity-node__body">{body}</div>}

      <ConfirmDialog open={!!deleting} title={deleteTitle} confirmLabel="Delete" variant="danger" onConfirm={confirmDelete} onClose={() => setDeleting(null)}>
        {deleting?.entity
          ? <p>The entity <span className="mono" title={isHttpIri(id) ? id : undefined}>{short(id)}</span> and all its attributes are deleted.</p>
          : deleting?.path?.length
            ? <p>Only the sub-attribute <strong>{short(deleting.path.at(-1))}</strong> is removed; <strong>{shortPath(deleting.name, deleting.path.slice(0, -1))}</strong> and its other sub-attributes remain.</p>
            : deleting?.instance
              ? <p>Only the instance <strong>{instanceText(deleting.name, deleting.instance)}</strong> and its sub-attributes are removed; the attribute’s other instances remain.</p>
              : <p>The attribute <strong>{short(deleting?.name ?? '')}</strong> and its sub-attributes are removed from this entity.</p>}
      </ConfirmDialog>
    </article>
  )
}
