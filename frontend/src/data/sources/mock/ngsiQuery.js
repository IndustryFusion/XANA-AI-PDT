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

import { DataError } from '../../errors'

/**
 * Parser and evaluator for the subset of the NGSI-LD query language (`q`)
 * the mock supports:
 *   attr==value  attr!=value  attr>value  attr>=value  attr<value  attr<=value
 *   attr~=regex  attr!~=regex  attr (exists)  !attr (does not exist)
 *   a;b (and)  a|b (or)  ( … )
 * Paths: `attr`, `attr.subAttribute`, `attr[key]`. Values: "quoted text",
 * numbers, true/false, ranges `1..5`, lists `"a","b"` and unquoted text
 * such as identifiers or dates.
 */

const invalid = (message) => new DataError('entities', 'invalid', message)
const OPERATORS = ['==', '!=', '>=', '<=', '!~=', '~=', '>', '<']

export function parseQuery(text) {
  const src = String(text ?? '')
  let pos = 0
  const fail = (what) => { throw invalid(`The query expression is not valid: ${what} at position ${pos + 1}.`) }
  const skip = () => { while (src[pos] === ' ') pos++ }

  function or() {
    const terms = [and()]
    skip()
    while (src[pos] === '|') { pos++; terms.push(and()); skip() }
    return terms.length === 1 ? terms[0] : { op: 'or', terms }
  }

  function and() {
    const terms = [unary()]
    skip()
    while (src[pos] === ';') { pos++; terms.push(unary()); skip() }
    return terms.length === 1 ? terms[0] : { op: 'and', terms }
  }

  function unary() {
    skip()
    if (src[pos] === '(') {
      pos++
      const inner = or()
      skip()
      if (src[pos] !== ')') fail('missing ")"')
      pos++
      return inner
    }
    if (src[pos] === '!' && src[pos + 1] !== '=' && src.slice(pos, pos + 3) !== '!~=') {
      pos++
      return { op: 'missing', path: path() }
    }
    const p = path()
    skip()
    const op = OPERATORS.find((o) => src.startsWith(o, pos))
    if (!op) return { op: 'exists', path: p }
    pos += op.length
    skip()
    return { op, path: p, value: value() }
  }

  function name() {
    const m = /^[A-Za-z_@][\w@:-]*/.exec(src.slice(pos))
    if (!m) fail('expected an attribute name')
    pos += m[0].length
    return m[0]
  }

  function path() {
    const parts = [name()]
    let key = null
    while (src[pos] === '.') { pos++; parts.push(name()) }
    if (src[pos] === '[') {
      pos++
      key = name()
      if (src[pos] !== ']') fail('missing "]"')
      pos++
    }
    return { attr: parts[0], sub: parts.slice(1), key }
  }

  function single() {
    skip()
    if (src[pos] === '"') {
      let out = ''
      pos++
      while (pos < src.length && src[pos] !== '"') {
        if (src[pos] === '\\' && pos + 1 < src.length) pos++
        out += src[pos++]
      }
      if (src[pos] !== '"') fail('unterminated text value')
      pos++
      return out
    }
    const m = /^[^;|)",]+/.exec(src.slice(pos))
    if (!m || !m[0].trim()) fail('expected a value')
    pos += m[0].length
    const raw = m[0].trim()
    if (raw === 'true') return true
    if (raw === 'false') return false
    if (/^-?\d+(\.\d+)?$/.test(raw)) return Number(raw)
    return raw
  }

  function value() {
    const first = single()
    if (typeof first === 'string') {
      const range = /^(-?\d+(?:\.\d+)?)\.\.(-?\d+(?:\.\d+)?)$/.exec(first)
      if (range) return { range: [Number(range[1]), Number(range[2])] }
    }
    const list = [first]
    while (src[pos] === ',') { pos++; list.push(single()) }
    return list.length === 1 ? first : { list }
  }

  skip()
  if (pos >= src.length) return null
  const tree = or()
  skip()
  if (pos < src.length) fail(`unexpected "${src[pos]}"`)
  return tree
}

/** Plain values an attribute (or every instance of it) holds, for comparison. */
function valuesOf(attr, sub, key) {
  const instances = Array.isArray(attr) ? attr : [attr]
  const out = []
  for (let inst of instances) {
    for (const s of sub) inst = inst?.[s]
    if (!inst || typeof inst !== 'object') continue
    let v
    if ('object' in inst) v = inst.object
    else if ('vocab' in inst) v = inst.vocab
    else if ('valueList' in inst) v = inst.valueList
    else if ('languageMap' in inst) v = Object.values(inst.languageMap)
    else if ('json' in inst) v = inst.json
    else if (inst.type === 'GeoProperty') continue
    else v = inst.value
    if (v && typeof v === 'object' && !Array.isArray(v) && '@id' in v) v = v['@id']
    if (key != null) v = v?.[key]
    if (Array.isArray(v)) out.push(...v)
    else if (v !== undefined) out.push(v)
  }
  return out
}

function compare(a, op, b) {
  if (op === '==' || op === '!=') {
    let eq
    if (b && typeof b === 'object' && 'range' in b) eq = typeof a === 'number' && a >= b.range[0] && a <= b.range[1]
    else if (b && typeof b === 'object' && 'list' in b) eq = b.list.some((x) => String(x) === String(a))
    else eq = typeof a === 'number' && typeof b === 'number' ? a === b : String(a) === String(b)
    return op === '==' ? eq : !eq
  }
  if (op === '~=' || op === '!~=') {
    let re
    try { re = new RegExp(String(b)) } catch { throw invalid(`"${b}" is not a valid pattern.`) }
    return re.test(String(a)) === (op === '~=')
  }
  if (typeof a === 'number' && typeof b === 'number') {
    return { '>': a > b, '>=': a >= b, '<': a < b, '<=': a <= b }[op]
  }
  if (typeof a === 'string' && typeof b === 'string') {
    return { '>': a > b, '>=': a >= b, '<': a < b, '<=': a <= b }[op]
  }
  return false
}

export function matches(entity, tree) {
  if (!tree) return true
  if (tree.op === 'and') return tree.terms.every((t) => matches(entity, t))
  if (tree.op === 'or') return tree.terms.some((t) => matches(entity, t))
  const { attr, sub, key } = tree.path
  const present = valuesOf(entity[attr], sub, key)
  if (tree.op === 'exists') return entity[attr] !== undefined && (sub.length === 0 && key == null ? true : present.length > 0)
  if (tree.op === 'missing') return entity[attr] === undefined || ((sub.length > 0 || key != null) && present.length === 0)
  if (tree.op === '!=' || tree.op === '!~=') return present.length > 0 && present.every((v) => compare(v, tree.op, tree.value))
  return present.some((v) => compare(v, tree.op, tree.value))
}

/** Validates a query and returns a predicate over entities; throws `invalid`. */
export function compileQuery({ type, id, idPattern, q, limit } = {}) {
  const types = type ? String(type).split(',').map((t) => t.trim()).filter(Boolean) : null
  const ids = id ? String(id).split(',').map((t) => t.trim()).filter(Boolean) : null
  let pattern = null
  if (idPattern) {
    try { pattern = new RegExp(idPattern) } catch { throw invalid(`The ID pattern "${idPattern}" is not a valid regular expression.`) }
  }
  const max = limit == null || limit === '' ? 100 : Number(limit)
  if (!Number.isInteger(max) || max < 1 || max > 1000) throw invalid('The limit must be a whole number from 1 to 1000.')
  const tree = parseQuery(q)
  // Validate patterns of the expression once, even if no entity is compared.
  const check = (t) => {
    if (!t) return
    if (t.terms) t.terms.forEach(check)
    if (t.op === '~=' || t.op === '!~=') compare('', t.op, t.value)
  }
  check(tree)
  return {
    limit: max,
    needsFilter: !!(tree || pattern),
    test: (e) => (!types || types.includes(e.type))
      && (!ids || ids.includes(e.id))
      && (!pattern || pattern.test(e.id))
      && matches(e, tree),
  }
}
