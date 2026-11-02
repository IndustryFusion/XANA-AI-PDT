import { useCallback, useId, useState } from 'react'
import { useData } from '../../data/useData'
import { Link, useRoute } from '../../app/router'
import { Button, Card, DataView, EmptyState, ErrorState, StatusBadge } from '../../ui/components'
import { formatTime } from '../../ui/format'
import { displayName } from './attributes'
import DeleteByTypeDialog from './DeleteByTypeDialog'
import EntityView from './EntityView'
import ImportDialog from './ImportDialog'
import { entityPath, explorerPath, hasCriteria, readQuery, toRequest } from './query'
import QueryBar from './QueryBar'
import { useLiveUpdates } from './useLiveUpdates'
import './explorer.css'

/** Matching entities with ID, type and name. */
function EntityList({ result, query, selected }) {
  if (!hasCriteria(query)) {
    return (
      <Card title="Entities">
        <EmptyState title="No query yet.">Choose an entity type, an ID, an ID pattern or attribute conditions, then apply the query.</EmptyState>
      </Card>
    )
  }
  const invalid = result.status === 'error' && result.error?.kind === 'invalid'
  return (
    <Card title="Entities" className="entity-list">
      {invalid && result.data === undefined ? (
        <EmptyState title="No results.">Correct the query to see entities.</EmptyState>
      ) : invalid ? (
        <EntityItems list={result.data} query={query} selected={selected} />
      ) : (
        <DataView
          result={result}
          errorTitle="Could not query entities"
          isEmpty={(list) => list.length === 0}
          empty={<EmptyState title="No entities matched the query.">Change the type, ID or conditions and apply the query again.</EmptyState>}
        >
          {(list) => <EntityItems list={list} query={query} selected={selected} />}
        </DataView>
      )}
    </Card>
  )
}

function EntityItems({ list, query, selected }) {
  const limit = Number(query.limit)
  return (
    <div className="stack">
      <p className="muted entity-list__count">
        {list.length} {list.length === 1 ? 'entity' : 'entities'}{list.length >= limit ? ` (limit of ${limit} reached)` : ''}
      </p>
      <ul className="run-list__items">
        {list.map((e) => (
          <li key={e.id} className="run-list__item">
            <Link to={entityPath(e.id, query)} className="run-list__link" aria-current={selected === e.id ? 'true' : undefined}>
              <span className="run-list__issue">{displayName(e) ?? e.id}</span>
              <span className="run-list__meta"><span>{e.type}</span><span className="mono">{e.id}</span></span>
            </Link>
          </li>
        ))}
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
 * Data explorer area: query bar, matching entities and the selected entity,
 * with time-shift, import, bulk delete and live updates. The query and the
 * time-shift moment are part of the URL.
 */
export default function DataExplorer() {
  const { params, query: urlQuery, search, navigate } = useRoute()
  const query = readQuery(urlQuery)
  const at = query.at || null
  const entityId = params.entityId ?? null
  const [refreshKey, setRefreshKey] = useState(0)
  const [liveOn, setLiveOn] = useState(true)
  const [dialog, setDialog] = useState(null)
  const refresh = useCallback(() => setRefreshKey((k) => k + 1), [])

  const types = useData('entities', at ? 'listTypesAt' : 'listTypes', at ? [at] : [], { refreshKey })
  const attributes = useData('entities', 'listAttributes', [], { refreshKey })
  const request = toRequest(query)
  const list = useData('entities', at ? 'queryEntitiesAt' : 'queryEntities', at ? [at, request] : [request], { enabled: hasCriteria(query), refreshKey })
  const live = useLiveUpdates({ enabled: liveOn && !at, entityId })

  const listError = list.status === 'error' && list.error?.kind === 'invalid' ? list.error : null
  const typesError = types.status === 'error' && types.error?.kind === 'invalid' ? types.error : null
  const go = (next) => navigate(entityId ? entityPath(entityId, next) : explorerPath(next))

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

      <div className="split explorer__split">
        <div className="split__side"><EntityList result={list} query={query} selected={entityId} /></div>
        <div className="split__main">
          {entityId ? (
            <EntityView
              key={`${entityId}|${at ?? ''}`}
              id={entityId}
              query={query}
              liveUpdate={live.lastUpdate}
              onChanged={refresh}
              onDeleted={() => { refresh(); navigate(explorerPath(query)) }}
            />
          ) : (
            <div className="card"><div className="card__body">
              <EmptyState title="No entity selected.">Select an entity in the list, or follow a reference from another area.</EmptyState>
            </div></div>
          )}
        </div>
      </div>

      <ImportDialog open={dialog === 'import'} onClose={() => setDialog(null)} onImported={refresh} />
      <DeleteByTypeDialog open={dialog === 'delete'} types={types.data ?? []} onClose={() => setDialog(null)} onDeleted={refresh} />
    </section>
  )
}
