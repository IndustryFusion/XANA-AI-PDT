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

/**
 * NGSI-LD attribute model of the explorer: which kind an attribute is, its
 * instances, and which members are metadata or sub-attributes.
 */

/** Attribute kinds with their short labels and badge tones. */
export const KINDS = [
  { kind: 'property', label: 'Property', tone: 'progress' },
  { kind: 'iri', label: 'IRI', tone: 'info' },
  { kind: 'relationship', label: 'Relationship', tone: 'special' },
  { kind: 'geo', label: 'Geo', tone: 'success' },
  { kind: 'json', label: 'JSON', tone: 'warning' },
  { kind: 'language', label: 'Language', tone: 'info' },
  { kind: 'list', label: 'List', tone: 'attention' },
  { kind: 'vocabulary', label: 'Vocabulary', tone: 'danger' },
  { kind: 'other', label: 'Other', tone: 'neutral' },
]
export const kindInfo = (kind) => KINDS.find((k) => k.kind === kind) ?? KINDS.at(-1)

const BY_TYPE = {
  Relationship: 'relationship',
  ListRelationship: 'relationship',
  GeoProperty: 'geo',
  JsonProperty: 'json',
  LanguageProperty: 'language',
  ListProperty: 'list',
  VocabularyProperty: 'vocabulary',
}

/** Entity members that are not attributes. */
export const NOT_ATTRIBUTES = ['id', 'type', '@context', 'scope', 'createdAt', 'modifiedAt', 'deletedAt']
/** Attribute members that hold the value or metadata, not sub-attributes. */
const VALUE_MEMBERS = ['type', 'value', 'object', 'objectList', 'json', 'languageMap', 'valueList', 'vocab', 'observedAt', 'unitCode', 'datasetId', 'lang', 'createdAt', 'modifiedAt', 'instanceId', 'objectType']

const IRI = /^(urn:|https?:\/\/)\S+$/i

const XSD = 'http://www.w3.org/2001/XMLSchema#'
const INTEGERS = new Set(['integer', 'int', 'long', 'short', 'byte', 'nonNegativeInteger', 'positiveInteger',
  'nonPositiveInteger', 'negativeInteger', 'unsignedLong', 'unsignedInt', 'unsignedShort', 'unsignedByte'])
const DECIMALS = new Set(['double', 'float', 'decimal'])
const VALUE_OBJECT_KEYS = new Set(['@value', '@type', 'type', '@language'])

const localDatatype = (datatype) => {
  if (typeof datatype !== 'string') return null
  if (datatype.startsWith(XSD)) return datatype.slice(XSD.length)
  if (datatype.startsWith('xsd:')) return datatype.slice(4)
  return null
}

/** Whether a value is a JSON-LD value object: `@value`, with at most a datatype or a language. */
export const isValueObject = (value) =>
  !!value && typeof value === 'object' && !Array.isArray(value) && '@value' in value &&
  Object.keys(value).every((key) => VALUE_OBJECT_KEYS.has(key))

/**
 * A property value as its plain value (gh-84-read-declared-values). The platform declares its
 * doubles, and the broker returns one as `{"type": "…#double", "@value": 42.5}`; its merge keeps
 * the type, so a live value can come as `{"type": "…#double", "@value": "42.5"}`. A value object
 * is read as its `@value`, a number string under a numeric datatype as that number; anything
 * else -- plain values, IRI references -- as it is.
 */
export function literalOf(value) {
  if (!isValueObject(value)) return value
  const inner = value['@value']
  if (typeof inner !== 'string') return inner
  const local = localDatatype(value['@type'] ?? value.type)
  const text = inner.trim()
  if (INTEGERS.has(local) && /^[+-]?\d+$/.test(text)) return Number(text)
  if (DECIMALS.has(local) && text !== '' && !Number.isNaN(Number(text))) return Number(text)
  if (local === 'boolean' && (text === 'true' || text === 'false')) return text === 'true'
  return inner
}

/** The IRI an IRI-valued property points to, or null. */
export function iriOf(value) {
  if (value && typeof value === 'object' && !Array.isArray(value) && typeof value['@id'] === 'string') return value['@id']
  if (typeof value === 'string' && IRI.test(value)) return value
  return null
}

export function attributeKind(attr) {
  const inst = Array.isArray(attr) ? attr[0] : attr
  if (!inst || typeof inst !== 'object') return 'other'
  if (BY_TYPE[inst.type]) return BY_TYPE[inst.type]
  if (inst.type === 'Property' || (inst.type === undefined && 'value' in inst)) return iriOf(inst.value) ? 'iri' : 'property'
  return 'other'
}

const isAttribute = (v) => v && typeof v === 'object' && !Array.isArray(v) && typeof v.type === 'string'

/** `[name, attribute]` pairs of an entity's attributes, in the entity's own order. */
export const attributesOf = (entity) => Object.entries(entity).filter(([k]) => !NOT_ATTRIBUTES.includes(k))

/** `[name, sub-attribute]` pairs of an attribute. */
export const subAttributesOf = (attr) => Object.entries(attr).filter(([k, v]) => !VALUE_MEMBERS.includes(k) && isAttribute(v))

/** Instances of an attribute: one per array element (multi-attribute), else the attribute itself. */
export const instancesOf = (attr) => (Array.isArray(attr) ? attr : [attr])

/** Entity IDs a relationship instance points to. */
export const targetsOf = (attr) => [].concat(attr?.object ?? attr?.objectList?.map((o) => o.object ?? o) ?? [])

/** Human-readable name of an entity: its `name` value (English preferred) or null. */
export function displayName(entity) {
  const name = entity?.name
  if (!name) return null
  if (typeof name.value === 'string') return name.value
  if (name.languageMap) return name.languageMap.en ?? Object.values(name.languageMap)[0] ?? null
  return null
}

/** Value that the editor changes, per kind: `[member, current value]`, or null if not editable. */
export function editableValue(attr) {
  if (Array.isArray(attr)) return null
  const kind = attributeKind(attr)
  if (kind === 'property') {
    // A declared value is edited as its plain value; the backend keeps its datatype.
    const value = literalOf(attr.value)
    if (value === null || ['string', 'number', 'boolean'].includes(typeof value)) return ['value', value]
  }
  if (kind === 'vocabulary') return ['vocab', attr.vocab]
  if (kind === 'relationship' && typeof attr.object === 'string') return ['object', attr.object]
  if (kind === 'iri') return ['value', iriOf(attr.value)]
  return null
}

/** Converts editor text to a value of the same type as the current one. */
export function parseInput(text, current, member) {
  const trimmed = text.trim()
  if (member === 'value' && typeof current === 'object' && current && '@id' in current) return { '@id': trimmed }
  if (typeof current === 'number' && /^-?\d+(\.\d+)?$/.test(trimmed)) return Number(trimmed)
  if (typeof current === 'boolean' && (trimmed === 'true' || trimmed === 'false')) return trimmed === 'true'
  return trimmed
}

/**
 * Whether an attribute has history to offer: it has an observation time, or the store has rows
 * for it, as the platform records every change whether or not it states a time.
 */
export const hasHistory = (attr, recorded = false) => !Array.isArray(attr) && (!!attr?.observedAt || recorded) && ['property', 'relationship'].includes(attributeKind(attr))

/** The latest recorded state of an attribute: by its exact name, or its IRI ending in that name. */
export function statusOf(states, name) {
  if (!states) return null
  if (states[name]) return states[name]
  const key = Object.keys(states).find((k) => k.endsWith(`/${name}`) || k.endsWith(`#${name}`))
  return key ? states[key] : null
}

/** Whether two attribute values are the same, whatever the order of their members. */
export function sameValue(a, b) {
  if (a === b) return true
  // `42.5` and `{"type": "…#double", "@value": "42.5"}` are the same value in two forms.
  if (isValueObject(a) || isValueObject(b)) return sameValue(literalOf(a), literalOf(b))
  if (!a || !b || typeof a !== 'object' || typeof b !== 'object') return false
  if (Array.isArray(a) !== Array.isArray(b)) return false
  const keys = Object.keys(a)
  return keys.length === Object.keys(b).length && keys.every((key) => sameValue(a[key], b[key]))
}
