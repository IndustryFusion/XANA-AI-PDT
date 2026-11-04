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

import { attributesOf, NOT_ATTRIBUTES, subAttributesOf } from './attributes'

/**
 * Editing an entity as raw JSON: the edited text is checked against the
 * entity, then the difference is planned as data-interface calls
 * (`deleteAttribute`, `updateAttributes`, `appendAttributes`).
 *
 * `updateAttributes` merges a fragment into the attribute, so a changed
 * attribute is sent as the members that differ, sub-attributes that were
 * removed are deleted one by one, and an attribute whose type changed or
 * that lost other members is replaced (deleted, then appended).
 */

const same = (a, b) => JSON.stringify(a) === JSON.stringify(b)
const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v)

/** Pretty JSON of an entity as shown in the raw view. */
export const entityText = (entity) => JSON.stringify(entity, null, 2)

/** Parses edited text: `{ entity }`, or `{ error }` with the reason it cannot be saved. */
export function parseEntityText(text, current) {
  let next
  try {
    next = JSON.parse(text)
  } catch (err) {
    return { error: `The JSON is not valid: ${err.message}` }
  }
  if (!isObject(next)) return { error: 'The JSON must be a single entity (an object).' }
  if (next.id !== current.id) return { error: `The entity ID cannot be changed; it must stay ${current.id}.` }
  if (next.type !== current.type) return { error: `The entity type cannot be changed; it must stay ${current.type}.` }
  for (const [name, attr] of attributesOf(next)) {
    if (!isObject(attr) && !Array.isArray(attr)) return { error: `The attribute ${name} must be an object with a type and a value.` }
  }
  return { entity: next }
}

function changeOf(name, before, after) {
  const replace = [{ op: 'delete', name }, { op: 'append', attrs: { [name]: after } }]
  if (!isObject(before) || !isObject(after) || before.type !== after.type) return replace
  const subs = new Set(subAttributesOf(before).map(([sub]) => sub))
  if (Object.keys(before).some((key) => !subs.has(key) && !(key in after))) return replace

  const steps = [...subs].filter((sub) => !(sub in after)).map((sub) => ({ op: 'deleteSub', name, sub }))
  const fragment = Object.fromEntries(Object.entries(after).filter(([key, value]) => !same(before[key], value)))
  if (Object.keys(fragment).length > 0) {
    if ('observedAt' in after) fragment.observedAt = after.observedAt
    steps.push({ op: 'update', name, fragment })
  }
  return steps
}

/** Steps that turn `before` into `after`, in the order they are applied. */
export function planChanges(before, after) {
  const names = (e) => attributesOf(e).map(([name]) => name)
  const steps = names(before).filter((name) => !(name in after)).map((name) => ({ op: 'delete', name }))
  for (const name of names(before)) {
    if (name in after && !same(before[name], after[name])) steps.push(...changeOf(name, before[name], after[name]))
  }
  const added = names(after).filter((name) => !(name in before) && !NOT_ATTRIBUTES.includes(name))
  if (added.length > 0) steps.push({ op: 'append', attrs: Object.fromEntries(added.map((name) => [name, after[name]])) })
  return steps
}

/** Applies planned steps one after the other with the `entities` area of the data interface. */
export async function applyChanges(entities, id, steps) {
  for (const step of steps) {
    if (step.op === 'delete') await entities.deleteAttribute(id, step.name)
    else if (step.op === 'deleteSub') await entities.deleteAttribute(id, step.name, { subAttribute: step.sub })
    else if (step.op === 'update') await entities.updateAttributes(id, { [step.name]: step.fragment })
    else await entities.appendAttributes(id, step.attrs)
  }
}
