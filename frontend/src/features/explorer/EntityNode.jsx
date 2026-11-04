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
import { EntityRef, entityLabel } from '../../app/EntityRef'
import { entities } from '../../data'
import { useData } from '../../data/useData'
import { Button, useToast } from '../../ui/components'
import { ConfirmDialog } from '../../ui/structured'
import { attributesOf, displayName } from './attributes'
import AttributeLine from './AttributeLine'
import AddAttributeForm from './AddAttributeForm'
import { entityPath } from './query'
import { applyChanges } from './rawEdit'
import RawJsonEditor from './RawJsonEditor'

/** How long a live-updated value stays highlighted. */
export const HIGHLIGHT_MS = 3000
/** Number of depth tints the nested nodes cycle through. */
const TINTS = 5

const count = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`

/**
 * One entity as a collapsible node of the document tree. The header carries
 * the name, type, attribute count and the node's actions; the expanded body
 * lists the attributes in the entity's own order, or the editable raw JSON.
 * Relationship targets expand as nested nodes (`depth` > 0) whose `chain`
 * holds the entities shown above them, so a cycle is marked, not expanded.
 *
 * `expanded` and `onExpandedChange` control the node; nested nodes manage it
 * themselves. `summary` is the entity from the result list, shown until the
 * node has loaded its own copy.
 */
export default function EntityNode({
  id, summary, depth = 0, chain = [], query, expanded: expandedProp, onExpandedChange,
  current = false, listen, onChanged, onDeleted, standalone = false,
}) {
  const at = query.at || null
  const readOnly = !!at
  const [ownExpanded, setOwnExpanded] = useState(true)
  const expanded = expandedProp ?? ownExpanded
  const setExpanded = (next) => (onExpandedChange ? onExpandedChange(next) : setOwnExpanded(next))
  const result = useData('entities', at ? 'queryEntitiesAt' : 'getEntity', at ? [at, { id }] : [id], { enabled: expanded || !summary })
  const [overrides, setOverrides] = useState({})
  const [changed, setChanged] = useState({})
  const [raw, setRaw] = useState(false)
  const [adding, setAdding] = useState(false)
  const [historyOf, setHistoryOf] = useState(null)
  const [deleting, setDeleting] = useState(null)
  const ids = { title: useId(), body: useId() }
  const ref = useRef(null)
  const notify = useToast()

  useEffect(() => { setOverrides({}) }, [result.data])

  useEffect(() => {
    if (current) ref.current?.scrollIntoView?.({ block: 'start' })
  }, [current])

  useEffect(() => {
    if (!listen || at) return undefined
    const timers = new Set()
    let seq = 0
    const stop = listen(id, (attributes) => {
      const mark = ++seq
      const names = Object.keys(attributes)
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
  }, [listen, id, at])

  const level = Math.min(3 + depth, 6)
  const Heading = `h${level}`
  const loaded = at ? result.data?.[0] : result.data
  const missing = (result.status === 'error' && result.error?.kind === 'not_found') || (at && result.status === 'success' && !loaded)
  const failed = result.status === 'error' && !missing && !loaded && !summary

  if (missing && standalone) {
    return (
      <section className="entity-node entity-node--missing" data-entity={id} aria-labelledby={ids.title} ref={ref}>
        <h3 id={ids.title}>Entity not found</h3>
        <p className="muted">There is no entity <span className="mono">{id}</span>. Check the ID or query for entities above.</p>
      </section>
    )
  }
  if ((missing && !summary) || failed) {
    return (
      <div className="entity-node entity-node--problem" data-entity={id} role={failed ? 'alert' : undefined}>
        {missing
          ? <p>Entity <span className="mono">{id}</span> was not found.</p>
          : <p>Could not load <span className="mono">{id}</span>: {result.error?.message}</p>}
        {failed && <Button size="sm" onClick={result.retry}>Retry</Button>}
      </div>
    )
  }

  const base = loaded ?? summary
  const entity = base ? { ...base, ...overrides } : null
  const title = (entity && displayName(entity)) ?? entityLabel(id)
  const attributes = entity ? attributesOf(entity) : []
  const refTo = (target) => entityPath(target, query)
  const ownChain = [...chain, id]

  function refresh() {
    result.refresh()
    onChanged?.()
  }

  function saved(name) {
    notify(`${name} saved.`, 'success')
    refresh()
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
    }
  }

  async function confirmDelete() {
    if (deleting.entity) {
      await entities.deleteEntity(id)
      notify(`${id} deleted.`, 'success')
      if (onDeleted) onDeleted()
      else refresh()
      return
    }
    await entities.deleteAttribute(id, deleting.name, deleting.sub ? { subAttribute: deleting.sub } : {})
    notify(deleting.sub ? `Sub-attribute ${deleting.sub} of ${deleting.name} deleted.` : `${deleting.name} deleted.`, 'success')
    if (historyOf === deleting.name && !deleting.sub) setHistoryOf(null)
    refresh()
  }

  const deleteTitle = deleting?.entity ? 'Delete this entity?' : deleting?.sub ? `Delete the sub-attribute ${deleting.sub}?` : `Delete the attribute ${deleting?.name}?`

  const renderNested = (target) => (
    <EntityNode id={target} depth={depth + 1} chain={ownChain} query={query} listen={listen} onChanged={onChanged} />
  )

  const lineCtx = (name) => ({
    entityId: id, entityType: entity.type, readOnly, refTo, depth, chain: ownChain, headingLevel: level,
    changed: !!changed[name], historyOpen: historyOf === name,
    onSaved: saved,
    onHistory: (n) => setHistoryOf((h) => (h === n ? null : n)),
    onDelete: (n, sub) => setDeleting({ name: n, sub }),
    renderNested,
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

  return (
    <article
      className={`entity-node entity-node--depth-${depth % TINTS}${current ? ' entity-node--current' : ''}`}
      data-entity={id} aria-labelledby={ids.title} ref={ref}
    >
      <header className="entity-node__header">
        <Heading id={ids.title} className="entity-node__title">
          <button
            type="button" className="entity-node__toggle" aria-expanded={expanded}
            aria-controls={expanded ? ids.body : undefined} onClick={() => setExpanded(!expanded)}
          >
            <span className="entity-node__caret" aria-hidden="true">{expanded ? '▾' : '▸'}</span>
            <span>{title}</span>
          </button>
        </Heading>
        {entity && <span className="kind-tag entity-node__type">{entity.type}</span>}
        {entity && <span className="entity-node__count">{count(attributes.length, 'attribute')}</span>}
        <span className="entity-node__id"><EntityRef id={id} label={id} to={refTo(id)} /></span>
        <span className="entity-node__actions">
          <Button size="sm" variant="ghost" aria-pressed={raw} aria-label={`Raw JSON of ${title}`} onClick={() => openBody(() => setRaw((r) => !r))}>Raw JSON</Button>
          {!readOnly && (
            <Button size="sm" variant="ghost" aria-expanded={adding} aria-label={`Add attribute to ${title}`} onClick={() => openBody(() => { setRaw(false); setAdding((a) => !a) })}>
              Add attribute
            </Button>
          )}
          {!readOnly && (
            <Button size="sm" variant="ghost" className="entity-node__delete" aria-label={`Delete entity ${title}`} onClick={() => setDeleting({ entity: true })}>
              Delete entity…
            </Button>
          )}
        </span>
      </header>
      {expanded && <div id={ids.body} className="entity-node__body">{body}</div>}

      <ConfirmDialog open={!!deleting} title={deleteTitle} confirmLabel="Delete" variant="danger" onConfirm={confirmDelete} onClose={() => setDeleting(null)}>
        {deleting?.entity
          ? <p>The entity <span className="mono">{id}</span> and all its attributes are deleted.</p>
          : deleting?.sub
            ? <p>Only the sub-attribute <strong>{deleting.sub}</strong> is removed; the attribute <strong>{deleting.name}</strong> remains.</p>
            : <p>The attribute <strong>{deleting?.name}</strong> and its sub-attributes are removed from this entity.</p>}
      </ConfirmDialog>
    </article>
  )
}
