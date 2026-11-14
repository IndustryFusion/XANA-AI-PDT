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

import { entityLabel, entityMenuItems } from '../../app/EntityRef'
import { paths, useRoute } from '../../app/router'
import { useContextMenu } from '../../ui/ContextMenu'
import { useCopy } from '../explorer/Iri'

/**
 * IRIs in an alert's text. The validation that raises alerts names the
 * attribute it checked by its IRI, `[0]` for a dataset, and a sub-attribute
 * below it as `attribute ==> sub-attribute`; an entity is named by its URN.
 */
// An IRI starts at a word boundary: `turn:on` holds no `urn:`.
const IRI = /(?<![\w.+-])(?:https?:\/\/|urn:)[^\s"'<>]+/g
// What can follow an IRI in a sentence or a constraint, and is not part of it.
const TRAILING = /(?:\[\d*\])?(?:==)?[.,;:!?)}\]]*$/
const CHAIN = /^\s*(?:\[\d*\])?\s*==>\s*$/
// Vocabularies an alert quotes (datatypes, shapes), never attributes of the resource.
const VOCABULARIES = ['http://www.w3.org/2001/XMLSchema#', 'http://www.w3.org/1999/02/22-rdf-syntax-ns#', 'http://www.w3.org/2000/01/rdf-schema#', 'http://www.w3.org/ns/shacl#']

const isAttributeIri = (iri) => /^https?:\/\//.test(iri) && !VOCABULARIES.some((v) => iri.startsWith(v))

/**
 * The text as plain parts and IRIs: `{ text }` or `{ iri, levels }`, where
 * `levels` is the attribute path below the resource that the IRI names (an
 * attribute, or a sub-attribute after `==>`), or null for an entity or a
 * vocabulary term.
 */
export function iriParts(text) {
  const parts = []
  const value = String(text ?? '')
  let last = 0
  let parent = null
  // What the last IRI's match held after the IRI itself, such as `[0]==` of `A[0]==>B`.
  let tail = ''
  for (const match of value.matchAll(IRI)) {
    const raw = match[0]
    const iri = raw.replace(TRAILING, '')
    if (match.index > last) parts.push({ text: value.slice(last, match.index) })
    // `A[0] ==> B`: B is a sub-attribute of A.
    const between = tail + value.slice(last, match.index)
    const levels = !isAttributeIri(iri) ? null : parent && CHAIN.test(between) ? [...parent, iri] : [iri]
    parts.push({ iri, levels })
    tail = raw.slice(iri.length)
    if (tail) parts.push({ text: tail })
    parent = levels
    last = match.index + raw.length
  }
  if (last < value.length) parts.push({ text: value.slice(last) })
  return parts
}

/** One IRI of an alert, with its actions in a context menu (right click, Shift+F10, the menu key). */
function AlertIri({ iri, levels, resource }) {
  const { navigate } = useRoute()
  const copy = useCopy()
  const attribute = levels && resource
  const label = attribute ? `${levels.map(entityLabel).join(' > ')} of ${entityLabel(resource)}` : iri
  const menu = useContextMenu({
    label: `Actions for ${label}`,
    items: () => {
      if (attribute) {
        return [
          { label: 'Go to the attribute in the data explorer', primary: true, onSelect: () => navigate(paths.entity(resource, levels)) },
          { label: 'Copy IRI', onSelect: () => copy(iri, 'the IRI') },
          { label: 'Copy resource IRI', onSelect: () => copy(resource, 'the resource IRI') },
        ]
      }
      if (iri.startsWith('urn:')) {
        return [
          ...entityMenuItems(iri, navigate).map((item, i) => (i === 0 ? { ...item, label: 'Go to the entity in the data explorer', primary: true } : item)),
          { separator: true },
          { label: 'Copy IRI', onSelect: () => copy(iri, 'the IRI') },
        ]
      }
      return [{ label: 'Copy IRI', onSelect: () => copy(iri, 'the IRI') }]
    },
  })
  return (
    <span className="alert-iri mono" tabIndex={0} title={iri} {...menu.triggerProps}>
      {iri}
      <span className="visually-hidden"> (context menu: {attribute ? 'go to the attribute' : 'actions'})</span>
      {menu.menu}
    </span>
  )
}

/** Alert text with each IRI it names as an `AlertIri`. */
export default function AlertText({ text, resource }) {
  return iriParts(text).map((part, i) => (part.iri
    ? <AlertIri key={i} iri={part.iri} levels={part.levels} resource={resource} />
    : <span key={i}>{part.text}</span>))
}
