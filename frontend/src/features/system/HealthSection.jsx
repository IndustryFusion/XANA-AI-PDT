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
