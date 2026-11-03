import { useCallback, useEffect, useId, useState } from 'react'
import { useData } from '../../data/useData'
import { useRoute } from '../../app/router'
import { Button, Card, DataView, EmptyState, ErrorState, StatusBadge } from '../../ui/components'
import { formatTime } from '../../ui/format'
import DeleteByTypeDialog from './DeleteByTypeDialog'
import EntityNode from './EntityNode'
import ImportDialog from './ImportDialog'
import { entityPath, explorerPath, hasCriteria, readQuery, toRequest } from './query'
import QueryBar from './QueryBar'
import { useLiveUpdates } from './useLiveUpdates'
import './explorer.css'

/** Result list: matching entities as collapsible nodes, and an opened entity that is not among them. */
function EntityList({ result, query, standalone, renderNode }) {
  const invalid = result.status === 'error' && result.error?.kind === 'invalid'
  let content
  if (!hasCriteria(query)) {
    content = <EmptyState title="No query yet.">Choose an entity type, an ID, an ID pattern or attribute conditions, then apply the query.</EmptyState>
  } else if (invalid && result.data === undefined) {
    content = <EmptyState title="No results.">Correct the query to see entities.</EmptyState>
  } else if (invalid) {
    content = <EntityNodes list={result.data} query={query} renderNode={renderNode} />
  } else {
    content = (
      <DataView
        result={result}
        errorTitle="Could not query entities"
        isEmpty={(list) => list.length === 0}
        empty={<EmptyState title="No entities matched the query.">Change the type, ID or conditions and apply the query again.</EmptyState>}
      >
        {(list) => <EntityNodes list={list} query={query} renderNode={renderNode} />}
      </DataView>
    )
  }
  return (
    <Card title="Entities" className="entity-list">
      <div className="stack">
        {standalone && (
          <div className="entity-list__opened stack">
            <p className="muted entity-list__count">Opened entity, not among the query results:</p>
            {renderNode(standalone, null)}
          </div>
        )}
        {content}
      </div>
    </Card>
  )
}

function EntityNodes({ list, query, renderNode }) {
  const limit = Number(query.limit)
  return (
    <div className="stack">
      <p className="muted entity-list__count">
        {list.length} {list.length === 1 ? 'entity' : 'entities'}{list.length >= limit ? ` (limit of ${limit} reached)` : ''}
      </p>
      <ul className="entity-nodes" aria-label="Matching entities">
        {list.map((e) => <li key={e.id}>{renderNode(e.id, e)}</li>)}
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
      <Button type="submit" size="sm">Show</Button>
      {error && <span id={ids.error} className="field__error" role="alert">{error}</span>}
    </form>
  )
}

/**
 * Data explorer area: query bar and the matching entities as a document
 * tree, with time-shift, import, bulk delete and live updates. The query,
 * the time-shift moment and the last expanded entity are part of the URL.
 */
export default function DataExplorer() {
  const { params, query: urlQuery, search, navigate } = useRoute()
  const query = readQuery(urlQuery)
  const at = query.at || null
  const entityId = params.entityId ?? null
  const [refreshKey, setRefreshKey] = useState(0)
  const [liveOn, setLiveOn] = useState(true)
  const [dialog, setDialog] = useState(null)
  const [expanded, setExpanded] = useState(() => new Set(entityId ? [entityId] : []))
  const refresh = useCallback(() => setRefreshKey((k) => k + 1), [])

  // Opening an entity's URL (link, back, forward) expands its node.
  useEffect(() => {
    if (entityId) setExpanded((s) => (s.has(entityId) ? s : new Set(s).add(entityId)))
  }, [entityId])

  const types = useData('entities', at ? 'listTypesAt' : 'listTypes', at ? [at] : [], { refreshKey })
  const attributes = useData('entities', 'listAttributes', [], { refreshKey })
  const request = toRequest(query)
  const list = useData('entities', at ? 'queryEntitiesAt' : 'queryEntities', at ? [at, request] : [request], { enabled: hasCriteria(query), refreshKey })

  const listed = list.data ?? []
  const settled = !hasCriteria(query) || list.data !== undefined || list.status === 'error'
  const standalone = entityId && settled && !listed.some((e) => e.id === entityId) ? entityId : null
  const shownIds = [...listed.map((e) => e.id), ...(standalone ? [standalone] : [])].filter((id) => expanded.has(id))
  const live = useLiveUpdates({ enabled: liveOn && !at, ids: shownIds })

  const listError = list.status === 'error' && list.error?.kind === 'invalid' ? list.error : null
  const typesError = types.status === 'error' && types.error?.kind === 'invalid' ? types.error : null
  const go = (next) => navigate(entityId ? entityPath(entityId, next) : explorerPath(next))

  function setNodeExpanded(id, open) {
    setExpanded((s) => {
      const next = new Set(s)
      if (open) next.add(id)
      else next.delete(id)
      return next
    })
    if (open && id !== entityId) navigate(entityPath(id, query), { scroll: false })
    if (!open && id === entityId) navigate(explorerPath(query), { replace: true, scroll: false })
  }

  function deleted(id) {
    setExpanded((s) => { const next = new Set(s); next.delete(id); return next })
    refresh()
    if (id === entityId) navigate(explorerPath(query))
  }

  const renderNode = (id, summary) => (
    <EntityNode
      key={`${id}|${at ?? ''}`}
      id={id}
      summary={summary ?? undefined}
      standalone={!summary}
      query={query}
      expanded={expanded.has(id)}
      onExpandedChange={(open) => setNodeExpanded(id, open)}
      current={id === entityId}
      listen={live.listen}
      onChanged={refresh}
      onDeleted={() => deleted(id)}
    />
  )

  return (
    <section className="page explorer" aria-labelledby="page-title">
      <div className="page__header">
        <h1 id="page-title">Data explorer</h1>
        <div className="row explorer__tools">
          <label className="row">
            <input type="checkbox" checked={liveOn} disabled={!!at} onChange={(e) => setLiveOn(e.target.checked)} />
            Live updates
          </label>
          <span aria-live="polite"><StatusBadge kind="live" value={at ? 'paused' : live.status} /></span>
          <TimeShiftControl key={at ?? 'present'} at={at} onShift={(moment) => go({ ...query, at: moment })} />
          <Button size="sm" onClick={() => setDialog('import')} disabled={!!at}>Import…</Button>
          <Button size="sm" variant="danger" onClick={() => setDialog('delete')} disabled={!!at}>Delete by type…</Button>
        </div>
      </div>

      {at && (
        <div className="timeshift-banner" role="region" aria-label="Historical view">
          <p><strong>Historical view:</strong> entity types and entities as they were on <time dateTime={at}>{formatTime(at)}</time>. Editing is disabled.</p>
          <Button size="sm" variant="primary" onClick={() => go({ ...query, at: '' })}>Return to the present</Button>
        </div>
      )}

      {types.status === 'error' && !typesError && <ErrorState title="Could not load entity types" error={types.error} onRetry={types.retry} />}

      <QueryBar
        key={search}
        query={query}
        types={types.data ?? []}
        attributes={attributes.data ?? []}
        error={listError ?? typesError}
        onApply={(next) => navigate(explorerPath({ ...next, at: query.at }))}
      />

      <EntityList result={list} query={query} standalone={standalone} renderNode={renderNode} />

      <ImportDialog open={dialog === 'import'} onClose={() => setDialog(null)} onImported={refresh} />
      <DeleteByTypeDialog open={dialog === 'delete'} types={types.data ?? []} onClose={() => setDialog(null)} onDeleted={refresh} />
    </section>
  )
}
