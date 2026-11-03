import { Fragment, useId } from 'react'
import { useData } from '../../data/useData'
import { EntityRef } from '../../app/EntityRef'
import { Link, paths } from '../../app/router'
import { Button, ErrorState, LoadingState, StatusBadge } from '../../ui/components'
import { formatTime, humanize } from '../../ui/format'
import { actionsFor } from './model'

const HISTORY_TYPES = { new: 'Raised', status: 'Status change', note: 'Note', severity: 'Severity change' }

/**
 * One alert: all attributes, the ordered history of status changes and
 * notes, its actions and the jumps to the affected entity and its incidents.
 */
export default function AlertDetail({ id, refreshKey, onAction, onClose }) {
  const result = useData('alerts', 'getAlert', [id], { refreshKey })
  const titleId = useId()

  if (result.status === 'loading' && result.data === undefined) return <LoadingState label="Loading alert…" />
  if (result.status === 'error' && result.error?.kind === 'not_found') {
    return (
      <section className="card" aria-labelledby={titleId}>
        <div className="card__body stack">
          <h2 id={titleId}>Alert not found</h2>
          <p className="muted">There is no alert {id}.</p>
          <div><Button size="sm" onClick={onClose}>Close</Button></div>
        </div>
      </section>
    )
  }
  if (result.status === 'error' && result.data === undefined) return <ErrorState title="Could not load the alert" error={result.error} onRetry={result.retry} />
  const alert = result.data

  return (
    <article className="card alert-detail" aria-labelledby={titleId}>
      <header className="card__header">
        <h2 id={titleId} className="card__title">Alert {alert.id}</h2>
        <Button size="sm" variant="ghost" onClick={onClose}>Close details</Button>
      </header>
      <div className="card__body stack">
        <p className="row">
          <StatusBadge kind="severity" value={alert.severity} />
          <StatusBadge kind="alert" value={alert.status} />
        </p>
        <p className="alert-detail__text">{alert.text}</p>

        <div className="row" role="group" aria-label="Actions">
          <Link to={paths.newIncident(alert.resource, alert.text)} className="btn btn--primary btn--sm">Start new incident</Link>
          {actionsFor(alert.status).map((a) => <Button key={a.action} size="sm" onClick={() => onAction(a.action, [alert.id])}>{a.label}…</Button>)}
        </div>

        <section aria-labelledby={`${titleId}-context`} className="stack">
          <h3 id={`${titleId}-context`} className="details__title">Context</h3>
          <ul className="plain-list alert-detail__context">
            <li><Link to={paths.entity(alert.resource)}>Open {alert.resource} in the data explorer</Link></li>
            <li><Link to={paths.activeIncidentsFor(alert.resource)}>Show active incidents of this machine</Link></li>
            <li><Link to={paths.historyFor(alert.resource)}>Show incident history of this machine</Link></li>
          </ul>
        </section>

        <section aria-labelledby={`${titleId}-attrs`} className="stack">
          <h3 id={`${titleId}-attrs`} className="details__title">Attributes</h3>
          <dl className="details">
            <dt>Resource</dt><dd><EntityRef id={alert.resource} /></dd>
            <dt>Event</dt><dd>{alert.event}</dd>
            <dt>Environment</dt><dd>{alert.environment}</dd>
            <dt>Service</dt><dd>{alert.service.join(', ')}</dd>
            {alert.group && <><dt>Group</dt><dd>{alert.group}</dd></>}
            {alert.value && <><dt>Value</dt><dd>{alert.value}</dd></>}
            {alert.origin && <><dt>Origin</dt><dd>{alert.origin}</dd></>}
            {alert.type && <><dt>Type</dt><dd>{alert.type}</dd></>}
            <dt>Created</dt><dd><time dateTime={alert.createTime}>{formatTime(alert.createTime)}</time></dd>
            <dt>Last received</dt><dd><time dateTime={alert.lastReceiveTime}>{formatTime(alert.lastReceiveTime)}</time></dd>
            <dt>Duplicates</dt><dd>{alert.duplicateCount}</dd>
            {Object.entries(alert.attributes ?? {}).map(([k, v]) => (
              <Fragment key={k}><dt>{humanize(k)}</dt><dd>{typeof v === 'object' ? JSON.stringify(v) : String(v)}</dd></Fragment>
            ))}
          </dl>
        </section>

        <section aria-labelledby={`${titleId}-history`} className="stack">
          <h3 id={`${titleId}-history`} className="details__title">History</h3>
          <ol className="alert-history">
            {alert.history.map((h, i) => (
              <li key={`${h.at}-${i}`} className="alert-history__item">
                <span className="row">
                  <time dateTime={h.at}>{formatTime(h.at)}</time>
                  <span>{HISTORY_TYPES[h.type] ?? humanize(h.type)}</span>
                  <StatusBadge kind="alert" value={h.status} />
                </span>
                <span>{h.text}</span>
                {h.user && <span className="muted">by {h.user}</span>}
              </li>
            ))}
          </ol>
        </section>
      </div>
    </article>
  )
}
