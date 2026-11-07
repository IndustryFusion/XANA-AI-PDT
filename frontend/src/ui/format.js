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

/** Display formats for times, ages, sizes, percentages and where a run came from. */

const RUN_SOURCE_LABELS = { operator: 'Operator', ngsi: 'Machine event', alert: 'Alert' }

export function runSourceLabel(source) {
  return RUN_SOURCE_LABELS[source] ?? RUN_SOURCE_LABELS.operator
}

/** What lists show: only what didn't come from an operator. */
export function triggeredBy(source) {
  return source && source !== 'operator' ? runSourceLabel(source) : null
}

export function formatTime(iso) {
  if (!iso) return ''
  return new Date(iso).toLocaleString(undefined, { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })
}

/** Time of day with seconds, for checks that are repeated within a minute. */
export function formatClock(iso) {
  if (!iso) return ''
  return new Date(iso).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', second: '2-digit' })
}

export function formatDate(iso) {
  if (!iso) return ''
  return new Date(iso).toLocaleDateString(undefined, { day: '2-digit', month: 'short', year: 'numeric' })
}

/** Time since `iso`, e.g. "4 min", "3 h 10 min", "2 d". */
export function formatAge(iso, now = Date.now()) {
  const minutes = Math.max(0, Math.floor((now - Date.parse(iso)) / 60_000))
  if (minutes < 1) return 'just now'
  if (minutes < 60) return `${minutes} min`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return minutes % 60 ? `${hours} h ${minutes % 60} min` : `${hours} h`
  return `${Math.floor(hours / 24)} d`
}

export function formatSize(bytes) {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

export const percent = (value) => `${Math.round(Number(value) * 100)}%`

/** "recommendedAction" → "Recommended action". */
export function humanize(key) {
  const words = String(key).replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/[_-]+/g, ' ').trim().toLowerCase()
  return words.charAt(0).toUpperCase() + words.slice(1)
}
