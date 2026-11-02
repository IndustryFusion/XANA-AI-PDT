import { useEffect, useId, useState } from 'react'
import { entities } from '../../data'
import { useData } from '../../data/useData'
import { Link, paths } from '../../app/router'
import { Button, ErrorState, LoadingState, Tabs, useToast } from '../../ui/components'
import { ConfirmDialog } from '../../ui/structured'
import { copyText } from '../../ui/clipboard'
import { displayName, groupAttributes } from './attributes'
import AttributeRow from './AttributeRow'
import AddAttributeDialog from './AddAttributeDialog'
import HistoryPane from './HistoryPane'
import { entityPath } from './query'

/** How long a live-updated value stays highlighted. */
export const HIGHLIGHT_MS = 3000

function RawJson({ entity }) {
  const notify = useToast()
  const text = JSON.stringify(entity, null, 2)
  async function copy() {
    const ok = await copyText(text)
    notify(ok ? 'Entity JSON copied.' : 'Could not copy to the clipboard.', ok ? 'success' : 'danger')
  }
  return (
    <div className="stack">
      <div className="row"><Button size="sm" onClick={copy}>Copy JSON</Button></div>
      <pre className="raw-json" tabIndex={0} aria-label="Entity JSON">{text}</pre>
    </div>
  )
}

function NotFound({ id }) {
  return (
    <section className="card" aria-labelledby="entity-title">
      <div className="card__body stack">
        <h2 id="entity-title">Entity not found</h2>
        <p className="muted">There is no entity <span className="mono">{id}</span>. Check the ID or query for entities above.</p>
      </div>
    </section>
  )
}

/**
 * One entity: attributes grouped by kind with values, metadata and
 * sub-attributes, the raw JSON, editing (not in a historical view), the
 * history of observed attributes, and live changes highlighted briefly.
 */
export default function EntityView({ id, query, liveUpdate, onChanged, onDeleted }) {
  const at = query.at || null
  const result = useData('entities', at ? 'queryEntitiesAt' : 'getEntity', at ? [at, { id }] : [id])
  const [overrides, setOverrides] = useState({})
  const [changed, setChanged] = useState({})
  const [historyOf, setHistoryOf] = useState(null)
  const [deleting, setDeleting] = useState(null)
  const [adding, setAdding] = useState(null)
  const [view, setView] = useState('attributes')
  const titleId = useId()
  const notify = useToast()

  useEffect(() => { setOverrides({}) }, [result.data])

  useEffect(() => {
    if (!liveUpdate || liveUpdate.entityId !== id || at) return undefined
    setOverrides((o) => ({ ...o, ...liveUpdate.attributes }))
    const names = Object.keys(liveUpdate.attributes)
    setChanged((c) => ({ ...c, ...Object.fromEntries(names.map((n) => [n, liveUpdate.seq])) }))
    const timer = setTimeout(() => {
      setChanged((c) => Object.fromEntries(Object.entries(c).filter(([n, seq]) => !names.includes(n) || seq !== liveUpdate.seq)))
    }, HIGHLIGHT_MS)
    return () => clearTimeout(timer)
  }, [liveUpdate, id, at])

  if (result.status === 'loading' && result.data === undefined) return <LoadingState label="Loading entity…" />
  const missing = (result.status === 'error' && result.error?.kind === 'not_found') || (at && result.status === 'success' && result.data.length === 0)
  if (missing) return <NotFound id={id} />
  if (result.status === 'error' && result.data === undefined) return <ErrorState title="Could not load the entity" error={result.error} onRetry={result.retry} />

  const base = at ? result.data[0] : result.data
  if (!base) return <NotFound id={id} />
  const entity = { ...base, ...overrides }
  const name = displayName(entity)
  const refTo = (target) => entityPath(target, query)
  const readOnly = !!at

  async function copyId() {
    const ok = await copyText(id)
    notify(ok ? `Copied ${id}` : 'Could not copy to the clipboard.', ok ? 'success' : 'danger')
  }

  function saved(attrName) {
    notify(`${attrName} saved.`, 'success')
    result.refresh()
    onChanged?.()
  }

  async function confirmDelete() {
    if (deleting.entity) {
      await entities.deleteEntity(id)
      notify(`${id} deleted.`, 'success')
      onDeleted?.()
      return
    }
    await entities.deleteAttribute(id, deleting.name, deleting.sub ? { subAttribute: deleting.sub } : {})
    notify(deleting.sub ? `Sub-attribute ${deleting.sub} of ${deleting.name} deleted.` : `${deleting.name} deleted.`, 'success')
    if (historyOf === deleting.name && !deleting.sub) setHistoryOf(null)
    result.refresh()
    onChanged?.()
  }

  const deleteTitle = deleting?.entity ? 'Delete this entity?' : deleting?.sub ? `Delete the sub-attribute ${deleting.sub}?` : `Delete the attribute ${deleting?.name}?`

  const attributes = (
    <div className="stack">
      {groupAttributes(entity).map((group) => (
        <section key={group.kind} className="attr-group" aria-labelledby={`${titleId}-${group.kind}`}>
          <h3 id={`${titleId}-${group.kind}`} className="attr-group__title">{group.group}</h3>
          <ul className="attr-group__list">
            {group.attributes.map(([attrName, attr]) => (
              <AttributeRow
                key={attrName} entity={entity} name={attrName} attr={attr} readOnly={readOnly}
                changed={!!changed[attrName]} refTo={refTo} historyOpen={historyOf === attrName}
                onSaved={saved}
                onHistory={(n) => setHistoryOf((h) => (h === n ? null : n))}
                onAddSub={(n) => setAdding({ parent: n })}
                onDelete={(n, sub) => setDeleting({ name: n, sub })}
              />
            ))}
          </ul>
        </section>
      ))}
      {historyOf && entity[historyOf] && (
        <HistoryPane key={historyOf} entityId={id} name={historyOf} unit={entity[historyOf].unitCode} onClose={() => setHistoryOf(null)} />
      )}
    </div>
  )

  return (
    <article className="card entity-view" aria-labelledby={titleId}>
      <header className="card__header entity-view__header">
        <div className="stack entity-view__title">
          <h2 id={titleId} className="card__title">{name ?? id}</h2>
          <p className="row">
            <span className="kind-tag">{entity.type}</span>
            <span className="mono">{id}</span>
          </p>
          <ul className="row entity-view__links" aria-label="Related">
            <li><Button size="sm" variant="ghost" onClick={copyId}>Copy ID</Button></li>
            <li><Link to={paths.newIncident(id)}>Start new incident</Link></li>
            <li><Link to={paths.activeIncidentsFor(id)}>Active incidents</Link></li>
            <li><Link to={paths.historyFor(id)}>Incident history</Link></li>
          </ul>
        </div>
        {!readOnly && (
          <div className="card__actions">
            <Button size="sm" onClick={() => setAdding({ parent: null })}>Add attribute…</Button>
            <Button size="sm" variant="danger" onClick={() => setDeleting({ entity: true })}>Delete entity…</Button>
          </div>
        )}
      </header>
      <div className="card__body">
        <Tabs
          label="Entity view"
          value={view}
          onChange={setView}
          tabs={[
            { id: 'attributes', label: 'Attributes', content: attributes },
            { id: 'raw', label: 'Raw JSON', content: <RawJson entity={entity} /> },
          ]}
        />
      </div>

      <ConfirmDialog open={!!deleting} title={deleteTitle} confirmLabel="Delete" variant="danger" onConfirm={confirmDelete} onClose={() => setDeleting(null)}>
        {deleting?.entity
          ? <p>The entity <span className="mono">{id}</span> and all its attributes are deleted.</p>
          : deleting?.sub
            ? <p>Only the sub-attribute <strong>{deleting.sub}</strong> is removed; the attribute <strong>{deleting.name}</strong> remains.</p>
            : <p>The attribute <strong>{deleting?.name}</strong> and its sub-attributes are removed from this entity.</p>}
      </ConfirmDialog>
      <AddAttributeDialog open={!!adding} entityId={id} parent={adding?.parent ?? null} onClose={() => setAdding(null)} onAdded={saved} />
    </article>
  )
}
