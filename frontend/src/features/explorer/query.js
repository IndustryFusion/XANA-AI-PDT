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

import { paths } from '../../app/router'

/**
 * Explorer query state. The query (type, ID, ID pattern, expression, limit)
 * and the time-shift moment live in the URL, so a link reproduces the view.
 */
export const DEFAULT_LIMIT = 50
export const QUERY_KEYS = ['type', 'id', 'idPattern', 'q', 'attrs', 'hasAttr', 'limit', 'offset', 'at']

/** Query and moment from the route's query string. */
export function readQuery(urlQuery) {
  return {
    type: urlQuery.type ?? '',
    id: urlQuery.id ?? '',
    idPattern: urlQuery.idPattern ?? '',
    q: urlQuery.q ?? '',
    attrs: urlQuery.attrs ?? '',
    hasAttr: urlQuery.hasAttr ?? '',
    limit: urlQuery.limit ?? String(DEFAULT_LIMIT),
    offset: urlQuery.offset ?? '0',
    at: urlQuery.at ?? '',
  }
}

/** Whether the query names anything to look for. */
export const hasCriteria = (query) => !!(query.type || query.id || query.idPattern || query.q || query.hasAttr)

/** The query as the data interface expects it. Paging and attributes are for the present only. */
export function toRequest(query, { past = false } = {}) {
  const request = { limit: Number(query.limit) }
  for (const key of ['type', 'id', 'idPattern', 'q']) if (query[key]) request[key] = query[key]
  if (past) return request
  if (Number(query.offset) > 0) request.offset = Number(query.offset)
  if (query.attrs) request.attrs = query.attrs
  if (query.hasAttr) request.hasAttr = query.hasAttr
  return request
}

/** `?type=…&q=…` for the given state (empty values and the default limit are left out). */
export function toSearch(query) {
  const params = new URLSearchParams()
  for (const key of QUERY_KEYS) {
    const value = query[key]
    if (!value || (key === 'limit' && String(value) === String(DEFAULT_LIMIT)) || (key === 'offset' && Number(value) === 0)) continue
    params.set(key, value)
  }
  const text = params.toString()
  return text ? `?${text}` : ''
}

export const explorerPath = (query) => `${paths.explorer()}${toSearch(query)}`
export const entityPath = (id, query) => `${paths.entity(id)}${toSearch(query)}`

/* ── Query builder ─────────────────────────────────────────────────────── */

/** Operators of the query builder; `exists` and `missing` take no value. */
export const OPERATORS = [
  { op: '==', label: 'equals' },
  { op: '!=', label: 'does not equal' },
  { op: '>', label: 'greater than' },
  { op: '>=', label: 'at least' },
  { op: '<', label: 'less than' },
  { op: '<=', label: 'at most' },
  { op: '~=', label: 'matches pattern' },
  { op: 'exists', label: 'exists' },
  { op: 'missing', label: 'does not exist' },
]
export const takesValue = (op) => op !== 'exists' && op !== 'missing'
export const emptyCondition = () => ({ attribute: '', op: '==', value: '' })

const quote = (text) => `"${String(text).replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`

function formatValue(op, value) {
  const text = String(value).trim()
  if (op !== '~=' && (/^-?\d+(\.\d+)?$/.test(text) || text === 'true' || text === 'false')) return text
  return quote(text)
}

/** Builder conditions combined with `and` or `or`, as an NGSI-LD `q` expression. */
export function buildExpression(conditions, combine = 'and') {
  return conditions
    .filter((c) => c.attribute && (!takesValue(c.op) || String(c.value).trim() !== ''))
    .map((c) => {
      if (c.op === 'exists') return c.attribute
      if (c.op === 'missing') return `!${c.attribute}`
      return `${c.attribute}${c.op}${formatValue(c.op, c.value)}`
    })
    .join(combine === 'or' ? '|' : ';')
}

/** Splits `text` at `;` or `|` outside quoted values. */
function split(text) {
  const parts = []
  const separators = []
  let current = ''
  let quoted = false
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    if (quoted && ch === '\\') { current += ch + (text[i + 1] ?? ''); i++; continue }
    if (ch === '"') quoted = !quoted
    if (!quoted && (ch === ';' || ch === '|')) { parts.push(current); separators.push(ch); current = '' } else current += ch
  }
  parts.push(current)
  return { parts, separators }
}

const unquote = (v) => (v.startsWith('"') && v.endsWith('"') && v.length > 1 ? v.slice(1, -1).replace(/\\(.)/g, '$1') : v)

/**
 * Builder state for an expression the builder produced; null if the
 * expression uses more than the builder offers (e.g. parentheses or mixed
 * combinations).
 */
export function parseExpression(q) {
  if (!q) return { conditions: [], combine: 'and' }
  const { parts, separators } = split(q)
  if (new Set(separators).size > 1) return null
  const conditions = []
  for (const part of parts) {
    const text = part.trim()
    if (/[()]/.test(text.replace(/"(?:[^"\\]|\\.)*"/g, ''))) return null
    const m = /^([A-Za-z_@][\w@:.[\]-]*?)(==|!=|>=|<=|~=|>|<)(.+)$/.exec(text)
    if (m) conditions.push({ attribute: m[1], op: m[2], value: unquote(m[3].trim()) })
    else if (/^![A-Za-z_@][\w@:.[\]-]*$/.test(text)) conditions.push({ attribute: text.slice(1), op: 'missing', value: '' })
    else if (/^[A-Za-z_@][\w@:.[\]-]*$/.test(text)) conditions.push({ attribute: text, op: 'exists', value: '' })
    else return null
  }
  return { conditions, combine: separators[0] === '|' ? 'or' : 'and' }
}
