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

import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from 'react'
import { rememberPath } from '../../app/lastPath'
import { useData } from '../../data/useData'
import { entities } from '../../data'
import { useRoute } from '../../app/router'
import { Button, Card, DataView, EmptyState, ErrorState, StatusBadge } from '../../ui/components'
import { formatTime } from '../../ui/format'
import { IconButton, Popover } from '../../ui/icons'
import DeleteByTypeDialog from './DeleteByTypeDialog'
import EntityNode from './EntityNode'
import ImportDialog from './ImportDialog'
import { Iri, shortenText, useRegistry } from './Iri'
import { registry } from './prefixes'
import { entityPath, explorerPath, hasCriteria, readQuery, toRequest } from './query'
import QueryBar from './QueryBar'
import {
  keepResults, keepScroll, keptResults, keptScroll, startQuery, unpin, useKept, usePins, useSelection, useUnnested,
} from './store'
import { useLiveUpdates } from './useLiveUpdates'
import './explorer.css'

const SOURCES = { context: 'configured context', 'well-known': 'well-known', derived: 'derived' }

/** The prefixes in use and where each comes from; a namespace is shown only in its tooltip and context menu. */
function PrefixLegend() {
  const reg = useRegistry()
  const [open, setOpen] = useState(false)
  const button = useRef(null)
  const entries = open ? reg.entries() : []
  return (
    <>
      <IconButton ref={button} icon="link" label="Prefix legend" aria-expanded={open} onClick={() => setOpen((o) => !o)} />
      {open && (
        <Popover anchor={button.current} label="Prefixes" onClose={() => setOpen(false)}>
          <table className="table prefix-legend" tabIndex={-1}>
            <caption>Prefixes in use</caption>
            <thead><tr><th scope="col">Prefix</th><th scope="col">From</th></tr></thead>
            <tbody>
              {entries.map((e) => (
                <tr key={e.prefix}><td className="mono"><Iri value={e.namespace} /></td><td>{SOURCES[e.source]}</td></tr>
              ))}
            </tbody>
          </table>
        </Popover>
      )}
    </>
  )
}

/** Reads the configured context's prefixes once per page load. */
function useContextPrefixes() {
  useEffect(() => {
    if (registry.contextLoaded) return
    let cancelled = false
    Promise.resolve()
      .then(() => entities.getPrefixes())
      .then((answer) => { if (!cancelled) registry.loadContext(answer?.prefixes ?? []) }, () => { if (!cancelled) registry.loadContext([]) })
    return () => { cancelled = true }
  }, [])
}

/** Result list: matching entities as collapsible nodes, and an opened entity that is not among them. */
function EntityList({ result, query, standalone, renderNode, onPage, pinned, unnested, hidden }) {
  const invalid = result.status === 'error' && result.error?.kind === 'invalid'
  let content
  if (!hasCriteria(query)) {
    content = <EmptyState title="No query yet.">Choose an entity type, an ID, an ID pattern or attribute conditions, then apply the query.</EmptyState>
  } else if (invalid && result.data === undefined) {
    content = <EmptyState title="No results.">Correct the query to see entities.</EmptyState>
  } else if (invalid) {
    content = <EntityNodes list={result.data} query={query} renderNode={renderNode} hidden={hidden} />
  } else {
    content = (
      <DataView
        result={result}
        errorTitle="Could not query entities"
        isEmpty={(list) => list.length === 0}
        empty={<EmptyState title="No entities matched the query.">Change the type, ID or conditions and apply the query again.</EmptyState>}
      >
        {(list) => <EntityNodes list={list} query={query} renderNode={renderNode} paged={!!onPage} hidden={hidden} />}
      </DataView>
    )
  }
  const limited = result.data?.limited
  return (
    <Card title="Entities" className="entity-list">
      <div className="stack">
        {pinned}
        {limited && (
          <p className="muted entity-list__count" role="status">
            Only the first {limited.scanned}{limited.total ? ` of ${limited.total}` : ''} entities were searched, so there may be more matches. Narrow the query by type or ID.
          </p>
        )}
        {standalone && (
          <div className="entity-list__opened stack">
            <p className="muted entity-list__count">Opened entity, not among the query results:</p>
            {renderNode(standalone, null)}
          </div>
        )}
        {content}
        {onPage && hasCriteria(query) && result.data && <Pager list={result.data} query={query} onPage={onPage} />}
        {unnested}
      </div>
    </Card>
  )
}

/** Previous and next page. Next is offered while the total says there is more, or, without one, after a full page. */
function Pager({ list, query, onPage }) {
  const limit = Number(query.limit)
  const offset = Number(query.offset) || 0
  const more = list.total != null ? offset + list.length < list.total : list.length >= limit
  if (offset === 0 && !more) return null
  return (
    <nav className="row entity-list__pager" aria-label="Result pages">
      <Button size="sm" disabled={offset === 0} onClick={() => onPage(Math.max(0, offset - limit))}>Previous page</Button>
      <Button size="sm" disabled={!more} onClick={() => onPage(offset + limit)}>Next page</Button>
    </nav>
  )
}

function EntityNodes({ list, query, renderNode, paged, hidden = [] }) {
  const limit = Number(query.limit)
  const offset = Number(query.offset) || 0
  const total = list.total
  let count = `${list.length} ${list.length === 1 ? 'entity' : 'entities'}${list.length >= limit ? ` (limit of ${limit} reached)` : ''}`
  if (paged && (offset > 0 || (total != null && total > list.length) || list.length >= limit)) {
    count = list.length === 0
      ? `No entities from ${offset + 1} on${total != null ? ` of ${total}` : ''}`
      : `Entities ${offset + 1}–${offset + list.length}${total != null ? ` of ${total}` : ''}`
  }
  return (
    <div className="stack">
      <p className="muted entity-list__count" role="status">{count}</p>
      <ul className="entity-nodes" aria-label="Matching entities">
        {list.filter((e) => !hidden.includes(e.id)).map((e) => <li key={e.id}>{renderNode(e.id, e)}</li>)}
      </ul>
    </div>
  )
}

const toLocalInput = (iso) => {
  const t = Date.parse(iso)
  return new Date(t - new Date(t).getTimezoneOffset() * 60_000).toISOString().slice(0, 16)
}

/** Picks the moment of the historical view. */
function TimeShiftControl({ at, onShift }) {
  const [value, setValue] = useState(at ? toLocalInput(at) : '')
  const [error, setError] = useState(null)
  const ids = { input: useId(), error: useId() }

  function submit(e) {
    e.preventDefault()
    const t = Date.parse(value)
    if (Number.isNaN(t)) { setError('Choose a date and time.'); return }
    if (t >= Date.now()) { setError('Choose a moment in the past.'); return }
    setError(null)
    onShift(new Date(t).toISOString())
  }

  return (
    <form className="row timeshift" onSubmit={submit} aria-label="Time-shift">
      <label className="field__label" htmlFor={ids.input}>View as of</label>
      <input
        id={ids.input} type="datetime-local" value={value} onChange={(e) => setValue(e.target.value)}
        aria-invalid={error ? true : undefined} aria-describedby={error ? ids.error : undefined}
      />
      <Button type="submit">Show</Button>
      {error && <span id={ids.error} className="field__error" role="alert">{error}</span>}
    </form>
  )
}

/** The pinned entities, at the top of the list, with unpinning of a selection. */
function PinnedList({ pins, renderNode }) {
  const selection = useSelection()
  if (!pins.length) return null
  const chosen = selection.filter((id) => pins.includes(id))
  return (
    <section className="entity-list__pinned stack" aria-label="Pinned entities">
      <div className="row entity-list__section">
        <p className="muted entity-list__count" role="status">{pins.length} pinned</p>
        <IconButton icon="pinned" label={`Unpin ${chosen.length} selected`} disabled={!chosen.length} onClick={() => unpin(chosen)} />
      </div>
      <ul className="entity-nodes" aria-label="Pinned">
        {pins.map((id) => <li key={id}>{renderNode(id, null, { place: 'pinned' })}</li>)}
      </ul>
    </section>
  )
}

/** Entities moved out of the tree, after the results, under a labelled separator. */
function UnnestedList({ list, renderNode }) {
  if (!list.length) return null
  return (
    <section className="entity-list__unnested stack" aria-label="Unnested entities">
      <p className="muted entity-list__separator">Unnested entities</p>
      <ul className="entity-nodes">
        {list.map((u) => <li key={u.id}>{renderNode(u.id, null, { place: 'unnested', origin: u.origin, nodeKey: `${u.origin.key}>${u.id}` })}</li>)}
      </ul>
    </section>
  )
}

/**
 * Data explorer area: query bar and the matching entities as a document
 * tree, with time-shift, import, bulk delete and live updates. The query,
 * the time-shift moment and the last expanded entity are part of the URL;
 * the rest of the view (results, expansions, unnested entities, pins,
 * scroll) is kept in the explorer's store, so it is the same on return.
 */
export default function DataExplorer() {
  useRegistry()
  useContextPrefixes()
  const { params, query: urlQuery, search, pathname, navigate } = useRoute()
  const query = readQuery(urlQuery)
  const at = query.at || null
  const entityId = params.entityId ?? null
  const [refreshKey, setRefreshKey] = useState(0)
  const [liveOn, setLiveOn] = useKept('liveOn', true)
  const [dialog, setDialog] = useState(null)
  const [expanded, setExpanded] = useKept('expanded', entityId ? [entityId] : [])
  const pins = usePins()
  const unnested = useUnnested()
  const refresh = useCallback(() => setRefreshKey((k) => k + 1), [])

  useEffect(() => { rememberPath('explorer', `${pathname}${search}`) }, [pathname, search])

  // Opening an entity's URL (link, back, forward) expands its node.
  useEffect(() => {
    if (entityId) setExpanded((s) => (s.includes(entityId) ? s : [...s, entityId]))
  }, [entityId, setExpanded])

  const types = useData('entities', at ? 'listTypesAt' : 'listTypes', at ? [at] : [], { refreshKey })
  const attributes = useData('entities', 'listAttributes', [], { refreshKey })
  const request = toRequest(query, { past: !!at })
  const resultsKey = JSON.stringify([at, request])
  const queryKey = JSON.stringify([at, { ...request, offset: undefined }])
  useEffect(() => { startQuery(queryKey) }, [queryKey])
  const list = useData('entities', at ? 'queryEntitiesAt' : 'queryEntities', at ? [at, request] : [request], {
    enabled: hasCriteria(query), refreshKey, initial: keptResults(resultsKey),
  })
  useEffect(() => { keepResults(resultsKey, list.data) }, [resultsKey, list.data])

  // The scroll position is kept on leaving and restored after the first paint on return.
  useLayoutEffect(() => {
    const y = keptScroll()
    if (y != null) requestAnimationFrame(() => window.scrollTo?.(0, y))
    return () => keepScroll(window.scrollY)
  }, [])

  const listed = list.data ?? []
  const settled = !hasCriteria(query) || list.data !== undefined || list.status === 'error'
  const standalone = entityId && settled && !listed.some((e) => e.id === entityId) && !pins.includes(entityId) ? entityId : null
  const ownIds = [...pins, ...unnested.map((u) => u.id)]
  const shownIds = [...listed.map((e) => e.id), ...(standalone ? [standalone] : [])].filter((id) => expanded.includes(id))
  const live = useLiveUpdates({ enabled: liveOn && !at, ids: [...new Set([...shownIds, ...ownIds])], onResync: refresh })

  const listError = list.status === 'error' && list.error?.kind === 'invalid' ? list.error : null
  const typesError = types.status === 'error' && types.error?.kind === 'invalid' ? types.error : null
  const go = (next) => navigate(entityId ? entityPath(entityId, next) : explorerPath(next))

  function setNodeExpanded(id, open) {
    setExpanded((s) => (open ? (s.includes(id) ? s : [...s, id]) : s.filter((x) => x !== id)))
    if (open && id !== entityId) navigate(entityPath(id, query), { scroll: false })
    if (!open && id === entityId) navigate(explorerPath(query), { replace: true, scroll: false })
  }

  function deleted(id) {
    setExpanded((s) => s.filter((x) => x !== id))
    refresh()
    if (id === entityId) navigate(explorerPath(query))
  }

  const renderNode = (id, summary, { place = 'top', origin = null, nodeKey = id } = {}) => {
    const top = place === 'top'
    return (
      <EntityNode
        key={`${id}|${at ?? ''}|${place}`}
        id={id}
        summary={summary ?? undefined}
        standalone={!summary}
        query={query}
        expanded={top ? expanded.includes(id) : undefined}
        onExpandedChange={top ? (open) => setNodeExpanded(id, open) : undefined}
        current={top && id === entityId}
        listen={live.listen}
        refreshKey={refreshKey}
        onChanged={refresh}
        onDeleted={() => deleted(id)}
        place={place}
        origin={origin}
        nodeKey={top ? id : nodeKey}
      />
    )
  }

  const typeName = query.type ? <> of the type <Iri value={query.type} /></> : null

  return (
    <section className="page explorer" aria-labelledby="page-title">
      <div className="page__header">
        <h1 id="page-title">Data explorer</h1>
        <div className="row explorer__tools">
          <label className="row">
            <input type="checkbox" checked={liveOn} disabled={!!at} onChange={(e) => setLiveOn(e.target.checked)} />
            Live updates
          </label>
          <span aria-live="polite" className="row explorer__live">
            <span title={live.detail ? shortenText(live.detail) : undefined}><StatusBadge kind="live" value={at ? 'paused' : live.status} /></span>
            {!at && live.status === 'unavailable' && live.detail && <span className="muted explorer__live-detail">{shortenText(live.detail)}</span>}
          </span>
          <TimeShiftControl key={at ?? 'present'} at={at} onShift={(moment) => go({ ...query, at: moment })} />
          <PrefixLegend />
          <Button onClick={() => setDialog('import')} disabled={!!at}>Import…</Button>
          <Button variant="danger" onClick={() => setDialog('delete')} disabled={!!at}>Delete by type…</Button>
        </div>
      </div>

      {at && (
        <div className="timeshift-banner" role="region" aria-label="Historical view">
          <p><strong>Historical view:</strong> entity types and entities{typeName} as they were on <time dateTime={at}>{formatTime(at)}</time>. Editing is disabled.</p>
          <Button size="sm" variant="primary" onClick={() => go({ ...query, at: '' })}>Return to the present</Button>
        </div>
      )}

      {types.status === 'error' && !typesError && <ErrorState title="Could not load entity types" error={types.error} onRetry={types.retry} />}

      <QueryBar
        key={search}
        query={query}
        types={types.data ?? []}
        attributes={attributes.data ?? []}
        entities={listed}
        past={!!at}
        error={listError ?? typesError}
        onApply={(next) => navigate(explorerPath({ ...next, at: query.at }))}
      />

      <EntityList
        result={list} query={query} standalone={standalone} renderNode={renderNode} hidden={pins}
        onPage={at ? null : (offset) => navigate(explorerPath({ ...query, offset: String(offset) }))}
        pinned={<PinnedList pins={pins} renderNode={renderNode} />}
        unnested={<UnnestedList list={unnested.filter((u) => !pins.includes(u.id))} renderNode={renderNode} />}
      />

      <ImportDialog open={dialog === 'import'} onClose={() => setDialog(null)} onImported={refresh} />
      <DeleteByTypeDialog open={dialog === 'delete'} types={types.data ?? []} onClose={() => setDialog(null)} onDeleted={refresh} />
    </section>
  )
}
