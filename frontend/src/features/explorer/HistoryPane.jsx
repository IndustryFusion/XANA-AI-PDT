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

import { lazy, Suspense, useId, useMemo, useState } from 'react'
import { useData } from '../../data/useData'
import { Button, DataView, EmptyState, LoadingState } from '../../ui/components'
import { formatTime } from '../../ui/format'
import { IconButton } from '../../ui/icons'
import { statusOf } from './attributes'
import { Iri } from './Iri'
import { isHttpIri, registry } from './prefixes'

// The chart library is loaded only when a history chart is shown.
const HistoryChart = lazy(() => import('./HistoryChart'))

const HOUR = 3600_000
export const RANGES = [
  { id: '1h', label: 'Last hour', ms: HOUR },
  { id: '6h', label: 'Last 6 hours', ms: 6 * HOUR },
  { id: '24h', label: 'Last 24 hours', ms: 24 * HOUR },
  { id: '7d', label: 'Last 7 days', ms: 7 * 24 * HOUR },
  { id: 'custom', label: 'Custom range' },
]

const toLocalInput = (ms) => {
  const d = new Date(ms - new Date(ms).getTimezoneOffset() * 60_000)
  return d.toISOString().slice(0, 16)
}

/** A recorded value in the table: an IRI as its short name, anything else as text. */
function Recorded({ value }) {
  if (isHttpIri(value)) return <Iri value={value} />
  if (value && typeof value === 'object' && isHttpIri(value['@id'])) return <Iri value={value['@id']} />
  return String(value)
}

/**
 * History of one attribute, or of a sub-attribute at `path` below it, over a
 * selectable time range: chart (numeric values) and table.
 */
export default function HistoryPane({ entityId, name, path = [], unit, headingLevel = 3, onClose }) {
  const Heading = `h${Math.min(headingLevel, 6)}`
  const [range, setRange] = useState('24h')
  const [custom, setCustom] = useState(() => ({ from: toLocalInput(Date.now() - 24 * HOUR), to: toLocalInput(Date.now()) }))
  const [applied, setApplied] = useState(custom)
  const ids = { range: useId(), from: useId(), to: useId(), title: useId() }

  const span = useMemo(() => {
    if (range === 'custom') return { from: new Date(applied.from).toISOString(), to: new Date(applied.to).toISOString() }
    const now = Date.now()
    return { from: new Date(now - RANGES.find((r) => r.id === range).ms).toISOString(), to: new Date(now).toISOString() }
  }, [range, applied])
  const validCustom = range !== 'custom' || (!Number.isNaN(Date.parse(custom.from)) && !Number.isNaN(Date.parse(custom.to)) && Date.parse(custom.from) < Date.parse(custom.to))
  const result = useData('entities', 'getAttributeHistory', [entityId, name, path.length ? { ...span, path } : span])
  const states = useData('entities', 'getAttributeStatus', [entityId])
  const state = path.length ? null : statusOf(states.data, name)
  const title = [name, ...path].map((n) => registry.shorten(n)).join('.')

  return (
    <section className="card history" aria-labelledby={ids.title}>
      <header className="card__header">
        <Heading id={ids.title} className="card__title">History of {title}</Heading>
        <IconButton icon="close" label={`Close history of ${title}`} onClick={onClose} />
      </header>
      <div className="card__body stack">
        <div className="field-row">
          <div className="field">
            <label className="field__label" htmlFor={ids.range}>Time range</label>
            <select id={ids.range} value={range} onChange={(e) => setRange(e.target.value)}>
              {RANGES.map((r) => <option key={r.id} value={r.id}>{r.label}</option>)}
            </select>
          </div>
          {range === 'custom' && (
            <>
              <div className="field">
                <label className="field__label" htmlFor={ids.from}>From</label>
                <input id={ids.from} type="datetime-local" value={custom.from} onChange={(e) => setCustom((c) => ({ ...c, from: e.target.value }))} />
              </div>
              <div className="field">
                <label className="field__label" htmlFor={ids.to}>To</label>
                <input id={ids.to} type="datetime-local" value={custom.to} onChange={(e) => setCustom((c) => ({ ...c, to: e.target.value }))} />
              </div>
              <Button onClick={() => setApplied(custom)} disabled={!validCustom}>Show range</Button>
            </>
          )}
        </div>
        {!validCustom && <p className="field__error">The start of the range must be before its end.</p>}
        {state?.deleted && <p className="muted" role="status">This attribute was deleted on <time dateTime={state.observedAt}>{formatTime(state.observedAt)}</time>. Its earlier values are shown below.</p>}
        <DataView
          result={result}
          errorTitle="Could not load the history"
          isEmpty={(points) => points.length === 0}
          empty={<EmptyState title="There is no data in this time range." >Choose another time range.</EmptyState>}
        >
          {(points) => {
            const numeric = points.every((p) => typeof p.value === 'number')
            return (
              <>
                {numeric && (
                  <Suspense fallback={<LoadingState label="Loading chart…" />}>
                    <HistoryChart points={points} name={title} unit={unit} />
                  </Suspense>
                )}
                {points.limited?.newest && <p className="muted" role="status">Only the newest {points.limited.newest} values are shown. Choose a shorter time range to see older ones.</p>}
                <div className="table-wrap history__table" tabIndex={0} role="region" aria-label={`Values of ${title}`}>
                  <table className="table">
                    <caption>
                      {points.length} values from {formatTime(points[0].at)} to {formatTime(points.at(-1).at)}, newest first
                      {numeric ? ' (the same values as in the chart)' : ''}
                    </caption>
                    <thead><tr><th scope="col">Time</th><th scope="col">Value{unit ? ` (${unit})` : ''}</th></tr></thead>
                    <tbody>
                      {[...points].reverse().map((p, i) => (
                        <tr key={`${p.at}-${i}`}><td><time dateTime={p.at}>{formatTime(p.at)}</time></td><td><Recorded value={p.value} /></td></tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            )
          }}
        </DataView>
      </div>
    </section>
  )
}
