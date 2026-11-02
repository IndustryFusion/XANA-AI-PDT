import { useData } from '../../data/useData'
import { Button, Card, DataView, StatusBadge } from '../../ui/components'
import { formatClock } from '../../ui/format'
import { describeStatus } from '../../ui/status'

/** Every dependency with status, latency, detail and time of the check, plus overall health. */
export default function HealthSection({ round, onCheckAgain }) {
  const result = useData('system', 'getHealth', [{ fresh: round > 0 }], { refreshKey: round })
  const health = result.data
  const checking = result.status === 'loading'
  return (
    <Card
      title="Dependency health"
      className="health"
      actions={<Button size="sm" onClick={onCheckAgain}>{checking && health ? 'Checking…' : 'Check again'}</Button>}
    >
      <DataView result={result} errorTitle="Could not check the dependencies" loadingLabel="Checking dependencies…">
        {(h) => (
          <div className="stack">
            <div className="row health__summary">
              <StatusBadge kind="health" value={h.overall} label={`Overall health: ${describeStatus('health', h.overall).label}`} />
              <span className="muted">Checked at <time dateTime={h.checkedAt}>{formatClock(h.checkedAt)}</time></span>
            </div>
            <div className="table-wrap">
              <table className="table health-table">
                <caption className="visually-hidden">Dependencies and their health</caption>
                <thead>
                  <tr>
                    <th scope="col">Dependency</th>
                    <th scope="col">Status</th>
                    <th scope="col">Latency</th>
                    <th scope="col">Detail</th>
                  </tr>
                </thead>
                <tbody>
                  {h.checks.map((c) => (
                    <tr key={c.id} data-check={c.id}>
                      <th scope="row">{c.label}</th>
                      <td><StatusBadge kind="health" value={c.status} /></td>
                      <td>{c.latencyMs != null ? `${c.latencyMs} ms` : <span className="muted">—</span>}</td>
                      <td className="health-table__detail">{c.detail ?? <span className="muted">—</span>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </DataView>
    </Card>
  )
}
