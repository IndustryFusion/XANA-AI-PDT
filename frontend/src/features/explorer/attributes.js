/**
 * NGSI-LD attribute model of the explorer: which kind an attribute is, how
 * attributes are grouped, and which members are metadata or sub-attributes.
 */

/** Attribute kinds in display order, with group headings and labels. */
export const KINDS = [
  { kind: 'property', label: 'Property', group: 'Properties' },
  { kind: 'iri', label: 'IRI', group: 'IRI values' },
  { kind: 'relationship', label: 'Relationship', group: 'Relationships' },
  { kind: 'geo', label: 'Geo', group: 'Geo properties' },
  { kind: 'json', label: 'JSON', group: 'JSON properties' },
  { kind: 'language', label: 'Language', group: 'Language properties' },
  { kind: 'list', label: 'List', group: 'List properties' },
  { kind: 'vocabulary', label: 'Vocabulary', group: 'Vocabulary properties' },
  { kind: 'other', label: 'Other', group: 'Other attributes' },
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

/** `[name, attribute]` pairs of an entity's attributes. */
export const attributesOf = (entity) => Object.entries(entity).filter(([k]) => !NOT_ATTRIBUTES.includes(k))

/** `[name, sub-attribute]` pairs of an attribute. */
export const subAttributesOf = (attr) => Object.entries(attr).filter(([k, v]) => !VALUE_MEMBERS.includes(k) && isAttribute(v))

/** Attributes grouped by kind, in display order: `[{ kind, label, group, attributes: [[name, attr]] }]`. */
export function groupAttributes(entity) {
  const groups = KINDS.map((k) => ({ ...k, attributes: [] }))
  for (const [name, attr] of attributesOf(entity)) groups.find((g) => g.kind === attributeKind(attr)).attributes.push([name, attr])
  return groups.filter((g) => g.attributes.length > 0)
}

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
  if (kind === 'property' && (attr.value === null || ['string', 'number', 'boolean'].includes(typeof attr.value))) return ['value', attr.value]
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

/** Attributes with recorded history are those with an observation time. */
export const hasHistory = (attr) => !Array.isArray(attr) && !!attr?.observedAt && attributeKind(attr) === 'property'
