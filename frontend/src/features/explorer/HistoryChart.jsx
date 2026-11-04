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

import { useEffect, useRef, useState } from 'react'
import { CartesianGrid, Line, LineChart, Tooltip, XAxis, YAxis } from 'recharts'
import { formatTime } from '../../ui/format'

const HEIGHT = 240

/** Width of an element, following resizes where the browser reports them. */
function useWidth(ref, fallback = 640) {
  const [width, setWidth] = useState(fallback)
  useEffect(() => {
    const el = ref.current
    if (!el) return undefined
    if (el.clientWidth) setWidth(el.clientWidth)
    if (typeof ResizeObserver === 'undefined') return undefined
    const observer = new ResizeObserver(([entry]) => { if (entry.contentRect.width) setWidth(Math.floor(entry.contentRect.width)) })
    observer.observe(el)
    return () => observer.disconnect()
  }, [ref])
  return width
}

/**
 * Line chart of numeric attribute history over time. Loaded on demand by the
 * history pane, so the chart library is not part of other areas' code.
 * The values are also listed in the table next to the chart.
 */
export default function HistoryChart({ points, name, unit }) {
  const ref = useRef(null)
  const width = useWidth(ref)
  const data = points.map((p) => ({ t: Date.parse(p.at), value: p.value }))
  const label = `Line chart of ${name}${unit ? ` in ${unit}` : ''} from ${formatTime(points[0].at)} to ${formatTime(points.at(-1).at)}`
  return (
    <div ref={ref} className="history-chart" role="img" aria-label={label}>
      <LineChart width={width} height={HEIGHT} data={data} margin={{ top: 8, right: 16, bottom: 8, left: 8 }} accessibilityLayer={false}>
        <CartesianGrid strokeDasharray="3 3" />
        <XAxis dataKey="t" type="number" scale="time" domain={['dataMin', 'dataMax']} tickFormatter={(t) => formatTime(new Date(t).toISOString())} minTickGap={40} />
        <YAxis domain={['auto', 'auto']} width={56} label={unit ? { value: unit, angle: -90, position: 'insideLeft' } : undefined} />
        <Tooltip labelFormatter={(t) => formatTime(new Date(t).toISOString())} formatter={(v) => [`${v}${unit ? ` ${unit}` : ''}`, name]} />
        <Line type="monotone" dataKey="value" dot={false} isAnimationActive={false} strokeWidth={2} />
      </LineChart>
    </div>
  )
}
