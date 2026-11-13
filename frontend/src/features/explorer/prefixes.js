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
 * Short names for IRIs. One registry per page load maps namespaces to
 * prefixes, so `http://opcfoundation.org/UA/Pumps/FlowRate` reads
 * `pumps:FlowRate`, and a prefix keeps its namespace until the page is
 * reloaded. Namespaces come, in this order of precedence, from the
 * configured JSON-LD context (via the backend), from a fixed list of
 * well-known vocabularies, and from a name derived per namespace.
 */

/** Well-known vocabularies: prefix → namespace. */
export const WELL_KNOWN = [
  ['ngsi-ld', 'https://uri.etsi.org/ngsi-ld/'],
  ['rdf', 'http://www.w3.org/1999/02/22-rdf-syntax-ns#'],
  ['rdfs', 'http://www.w3.org/2000/01/rdf-schema#'],
  ['xsd', 'http://www.w3.org/2001/XMLSchema#'],
  ['owl', 'http://www.w3.org/2002/07/owl#'],
  ['sh', 'http://www.w3.org/ns/shacl#'],
  ['schema', 'https://schema.org/'],
  ['saref', 'https://saref.etsi.org/core/'],
  ['opcua', 'http://opcfoundation.org/UA/'],
  ['di', 'http://opcfoundation.org/UA/DI/'],
  ['pumps', 'http://opcfoundation.org/UA/Pumps/'],
  ['machinery', 'http://opcfoundation.org/UA/Machinery/'],
  ['iffb', 'https://industry-fusion.org/base/v0.1/'],
  ['iffk', 'https://industry-fusion.org/knowledge/v0.1/'],
]

/** Names that are never prefixes, so a typed full IRI or URN is never read as a short name. */
export const RESERVED = ['http', 'https', 'urn']

const HTTP = /^https?:\/\/[^/?#\s]+/i
const GENERIC = new Set(['www', 'ontology', 'ontologies', 'contexts', 'context', 'ns', 'vocab', 'schema', 'schemas', 'ld', 'ngsi-ld', 'def', 'terms'])
const VERSION = /^v?\d+(\.\d+)*$/i
const MAX_LENGTH = 12

/** Text for a regular expression that matches it literally. */
export const escapeRegExp = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/** Whether a string is an http(s) IRI, the only kind that is shortened. */
export const isHttpIri = (text) => typeof text === 'string' && HTTP.test(text) && !/\s/.test(text)

/**
 * The namespace of an http(s) IRI: up to and including its last `#`, or else
 * its last `/` after the host. An IRI with nothing after the host has the
 * namespace `scheme://host/`.
 */
export function namespaceOf(iri) {
  const host = HTTP.exec(iri)[0]
  const hash = iri.lastIndexOf('#')
  if (hash >= host.length) return iri.slice(0, hash + 1)
  const slash = iri.lastIndexOf('/')
  if (slash >= host.length) return iri.slice(0, slash + 1)
  return `${host}/`
}

const camel = (text) => text
  .replace(/[^A-Za-z0-9]+(.)?/g, (_, c) => (c ? c.toUpperCase() : ''))
  .replace(/^[^A-Za-z]+/, '')
  .replace(/^./, (c) => c.toLowerCase())

/** A short name for a namespace: its last meaningful path segment, else its host's first label. */
export function deriveName(namespace) {
  const host = HTTP.exec(namespace)[0]
  const segments = namespace.slice(host.length).split(/[/#]/).filter(Boolean)
  for (const segment of segments.reverse()) {
    const lower = segment.toLowerCase()
    if (VERSION.test(segment) || GENERIC.has(lower)) continue
    const name = camel(segment).slice(0, MAX_LENGTH)
    if (name) return name
  }
  const labels = host.replace(/^https?:\/\//i, '').split(':')[0].split('.').filter((l) => l && l.toLowerCase() !== 'www')
  const name = labels.length ? camel(labels[0]).slice(0, MAX_LENGTH) : ''
  return name || null
}

/**
 * The registry: namespaces with their prefixes and where each comes from.
 * `version` grows with every change, so a view can tell when to render again.
 */
export function createRegistry() {
  const byNamespace = new Map()
  const byPrefix = new Map()
  const listeners = new Set()
  let version = 0
  let counter = 0
  let contextLoaded = false

  const changed = () => { version++; listeners.forEach((fn) => fn()) }

  function free(name) {
    if (!name || RESERVED.includes(name.toLowerCase()) || byPrefix.has(name)) {
      if (name && !RESERVED.includes(name.toLowerCase())) {
        for (let n = 2; ; n++) if (!byPrefix.has(`${name}${n}`)) return `${name}${n}`
      }
      for (;;) { counter++; if (!byPrefix.has(`ns${counter}`)) return `ns${counter}` }
    }
    return name
  }

  function add(prefix, namespace, source) {
    const entry = { prefix, namespace, source }
    byNamespace.set(namespace, entry)
    byPrefix.set(prefix, entry)
    return entry
  }

  function init() {
    byNamespace.clear()
    byPrefix.clear()
    counter = 0
    contextLoaded = false
    for (const [prefix, namespace] of WELL_KNOWN) add(prefix, namespace, 'well-known')
  }
  init()

  /** Longest registered namespace the IRI starts with. */
  function match(iri) {
    let best = null
    for (const entry of byNamespace.values()) {
      if (iri.startsWith(entry.namespace) && (!best || entry.namespace.length > best.namespace.length)) best = entry
    }
    // The bare `http://host` belongs to `http://host/`.
    if (!best && byNamespace.has(`${iri}/`)) best = byNamespace.get(`${iri}/`)
    return best
  }

  function ensure(iri) {
    const found = match(iri)
    if (found) return found
    const namespace = namespaceOf(iri)
    // A new name changes no name already shown, so nothing needs to render again.
    return add(free(deriveName(namespace)), namespace, 'derived')
  }

  return {
    get version() { return version },
    get contextLoaded() { return contextLoaded },
    subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn) },
    /** Starts again as after a reload. */
    reset() { init(); changed() },

    /**
     * The configured context's prefixes. They take precedence over the
     * well-known and derived names: a context prefix replaces the name of its
     * namespace, and takes its name from another namespace that hasn't been
     * shown yet. Only a name already shown for another namespace keeps it, and
     * the context prefix gets a suffix, so no shown name changes meaning.
     */
    loadContext(prefixes = []) {
      for (const { prefix, namespace } of prefixes) {
        if (!prefix || !isHttpIri(namespace)) continue
        const existing = byNamespace.get(namespace)
        if (existing?.source === 'context') continue
        const taken = byPrefix.get(prefix)
        if (taken && taken.namespace !== namespace && !taken.used && taken.source !== 'context') {
          // Not shown yet: the context's prefix takes the name, and the other namespace another one.
          const moved = free(prefix)
          byPrefix.delete(prefix)
          taken.prefix = moved
          byPrefix.set(moved, taken)
        }
        const clash = byPrefix.get(prefix)
        const name = (clash && clash.namespace !== namespace) || RESERVED.includes(prefix.toLowerCase()) ? free(prefix) : prefix
        if (existing) byPrefix.delete(existing.prefix)
        add(name, namespace, 'context')
      }
      contextLoaded = true
      changed()
    },

    /** `{ text, prefix, local, namespace }` for an http(s) IRI, or null for anything else. */
    parts(iri) {
      if (!isHttpIri(iri)) return null
      const entry = ensure(iri)
      entry.used = true
      const local = iri.length > entry.namespace.length ? iri.slice(entry.namespace.length) : ''
      return { text: `${entry.prefix}:${local}`, prefix: entry.prefix, local, namespace: entry.namespace }
    },

    /** The short name of an http(s) IRI; anything else, such as a URN, unchanged. */
    shorten(iri) {
      return this.parts(iri)?.text ?? iri
    },

    /**
     * An ID pattern as the operator typed it: a leading namespace, as the
     * explorer escapes it when it expands `prefix:`, as `prefix:` again.
     */
    shortenPattern(pattern) {
      const text = String(pattern ?? '')
      const found = [...byPrefix.values()]
        .filter((e) => text.startsWith(escapeRegExp(e.namespace)))
        .sort((a, b) => b.namespace.length - a.namespace.length)[0]
      if (!found) return text
      found.used = true
      return `${found.prefix}:${text.slice(escapeRegExp(found.namespace).length)}`
    },

    /** The entry of a prefix, or null. A prefix looked up, as when it is typed, is in use from then on. */
    lookup(prefix) {
      const entry = byPrefix.get(prefix) ?? null
      if (entry) entry.used = true
      return entry
    },

    /** The prefixes in use, sorted by name. */
    entries() { return [...byPrefix.values()].sort((a, b) => a.prefix.localeCompare(b.prefix)) },

    /**
     * Typed text as a full IRI. In this order: text starting with `http:`,
     * `https:` or `urn:`, or without a colon, is returned unchanged;
     * `prefix:local` with a known prefix is expanded; in an identifier field
     * a valid absolute URI is returned unchanged; anything else throws
     * `UnknownPrefixError` naming the prefix.
     */
    expand(text, { identifier = false } = {}) {
      const value = String(text ?? '').trim()
      const colon = value.indexOf(':')
      if (colon < 0 || /^(https?|urn):/i.test(value)) return value
      const prefix = value.slice(0, colon)
      const entry = this.lookup(prefix)
      if (entry) return entry.namespace + value.slice(colon + 1)
      if (identifier && /^[A-Za-z][A-Za-z0-9+.-]*:\S+$/.test(value)) return value
      throw new UnknownPrefixError(prefix)
    },
  }
}

export class UnknownPrefixError extends Error {
  constructor(prefix) {
    super(`The prefix ${prefix}: is unknown. Use a prefix from the legend or type the full IRI.`)
    this.name = 'UnknownPrefixError'
    this.prefix = prefix
  }
}

/** The page's registry. */
export const registry = createRegistry()

/** Every http(s) IRI inside a JSON value, as short names. */
export function shortenDeep(value, reg = registry) {
  if (typeof value === 'string') return reg.shorten(value)
  if (Array.isArray(value)) return value.map((v) => shortenDeep(v, reg))
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k, v]) => [reg.shorten(k), shortenDeep(v, reg)]))
  return value
}
