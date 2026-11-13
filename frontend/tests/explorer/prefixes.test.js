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

import { createRegistry, deriveName, leadingLiteral, namespaceOf, UnknownPrefixError } from '../../src/features/explorer/prefixes'

const PUMPS = 'http://opcfoundation.org/UA/Pumps/'

describe('short names', () => {
  test('a well-known namespace has its prefix, and a context prefix takes precedence', () => {
    const reg = createRegistry()
    expect(reg.shorten(`${PUMPS}FlowRate`)).toBe('pumps:FlowRate')
    reg.loadContext([{ prefix: 'pump', namespace: PUMPS }])
    expect(reg.shorten(`${PUMPS}FlowRate`)).toBe('pump:FlowRate')
    expect(reg.lookup('pump').source).toBe('context')
  })

  test('a derived prefix stays the same across two result sets', () => {
    const reg = createRegistry()
    const first = reg.shorten('https://example.com/ontology/plant/v1/Pump')
    reg.shorten('https://other.org/vocab/Thing')
    expect(reg.shorten('https://example.com/ontology/plant/v1/Valve')).toBe(first.replace('Pump', 'Valve'))
    expect(first).toBe('plant:Pump')
  })

  test('a clash gets a numeric suffix, and a context prefix never renames a shown one', () => {
    const reg = createRegistry()
    expect(reg.shorten('https://a.org/pumps/X')).toBe('pumps2:X')
    expect(reg.shorten('https://b.org/plant/Y')).toBe('plant:Y')
    reg.loadContext([{ prefix: 'plant', namespace: 'https://c.org/plant/' }])
    expect(reg.shorten('https://b.org/plant/Y')).toBe('plant:Y')
    expect(reg.shorten('https://c.org/plant/Z')).toBe('plant2:Z')
  })

  test('a namespace of scheme and host only, and the bare host, have a prefix', () => {
    const reg = createRegistry()
    expect(namespaceOf('http://example.org/x')).toBe('http://example.org/')
    expect(reg.shorten('http://example.org/x')).toBe('example:x')
    expect(reg.shorten('http://example.org')).toBe('example:')
    expect(reg.shorten('http://www.example.net/')).toBe('example2:')
  })

  test('an IRI that is a namespace is shown as its prefix and a colon', () => {
    const reg = createRegistry()
    expect(reg.shorten(PUMPS)).toBe('pumps:')
    expect(reg.shorten('http://www.w3.org/2001/XMLSchema#')).toBe('xsd:')
  })

  test('URNs and compacted terms are shown as they are', () => {
    const reg = createRegistry()
    expect(reg.shorten('urn:ngsi-ld:Pump:1')).toBe('urn:ngsi-ld:Pump:1')
    expect(reg.shorten('temperature')).toBe('temperature')
    expect(reg.parts('urn:ngsi-ld:Pump:1')).toBeNull()
  })

  test('every http IRI gets a prefix, also without a usable name', () => {
    const reg = createRegistry()
    expect(deriveName('http://192.0.2.1/')).toBeNull()
    expect(reg.shorten('http://192.0.2.1/a')).toBe('ns1:a')
    for (const iri of ['http://a.b/c', 'https://x.y/z#w', 'http://h', 'https://h.example/1.0/']) {
      expect(reg.shorten(iri)).toMatch(/^[A-Za-z][\w.-]*:/)
      expect(reg.shorten(iri)).not.toMatch(/^https?:/)
    }
  })

  test('a context prefix takes a name not shown yet, and the other namespace gets another', () => {
    const reg = createRegistry()
    reg.loadContext([{ prefix: 'schema', namespace: 'http://schema.org/' }])
    expect(reg.shorten('http://schema.org/name')).toBe('schema:name')
    expect(reg.expand('schema:name')).toBe('http://schema.org/name')
    expect(reg.shorten('https://schema.org/name')).toBe('schema2:name')
  })

  test('a prefix typed before the context arrives keeps its namespace', () => {
    const reg = createRegistry()
    expect(reg.expand('schema:name')).toBe('https://schema.org/name')
    reg.loadContext([{ prefix: 'schema', namespace: 'http://schema.org/' }])
    expect(reg.expand('schema:name')).toBe('https://schema.org/name')
    expect(reg.shorten('http://schema.org/name')).toBe('schema2:name')
  })

  test('http, https and urn are never prefixes', () => {
    const reg = createRegistry()
    expect(reg.shorten('https://http.example/x').startsWith('http:')).toBe(false)
    reg.loadContext([{ prefix: 'urn', namespace: 'https://u.example/' }])
    expect(reg.shorten('https://u.example/a').startsWith('urn:')).toBe(false)
  })
})

describe('typed short names', () => {
  const reg = createRegistry()
  reg.loadContext([{ prefix: 'did', namespace: 'https://did.example/' }])

  test('a known prefix is expanded', () => {
    expect(reg.expand('pumps:FlowRate')).toBe(`${PUMPS}FlowRate`)
    expect(reg.expand('pumps:')).toBe(PUMPS)
  })

  test('a full IRI, a URN and a plain term are taken as typed', () => {
    expect(reg.expand(`${PUMPS}X`)).toBe(`${PUMPS}X`)
    expect(reg.expand('urn:ngsi-ld:Pump:1', { identifier: true })).toBe('urn:ngsi-ld:Pump:1')
    expect(reg.expand('urn:ngsi-ld:Pump:1')).toBe('urn:ngsi-ld:Pump:1')
    expect(reg.expand('temperature')).toBe('temperature')
  })

  test('an identifier in another URI scheme is taken as typed', () => {
    expect(reg.expand('tag:example.org,2024:pump-1', { identifier: true })).toBe('tag:example.org,2024:pump-1')
  })

  test('a known prefix wins over a URI scheme of the same name', () => {
    expect(reg.expand('did:example:123', { identifier: true })).toBe('https://did.example/example:123')
  })

  test('an unknown prefix in a name is refused, naming it', () => {
    expect(() => reg.expand('nope:Thing')).toThrow(UnknownPrefixError)
    expect(() => reg.expand('nope:Thing')).toThrow('The prefix nope: is unknown')
    expect(() => reg.expand('did2:x y', { identifier: true })).toThrow(UnknownPrefixError)
  })
})

describe('ID patterns', () => {
  test('the leading literal part stops at the first special character or a class escape', () => {
    expect(leadingLiteral('http://ex\\.org/P.*')).toBe('http://ex.org/P')
    expect(leadingLiteral('http://ex\\.org/P\\d+')).toBe('http://ex.org/P')
    expect(leadingLiteral('^urn')).toBe('')
  })

  test('shortening and expanding use the same rule, also for any context prefix', () => {
    const reg = createRegistry()
    reg.loadContext([{ prefix: '_iff', namespace: 'http://ex.org/iff/' }])
    const pattern = 'http://ex\\.org/iff/P.*'
    expect(reg.shortenPattern(pattern)).toBe('_iff:P.*')
    expect(reg.expandPattern('_iff:P.*')).toBe(pattern)
    expect(reg.expandPattern('nope:P.*')).toBe('nope:P.*')
    expect(reg.expandPattern('urn:ngsi-ld:.*')).toBe('urn:ngsi-ld:.*')
  })

  test('a namespace not registered yet gets its prefix, as shorten() gives it', () => {
    const reg = createRegistry()
    expect(reg.shortenPattern('https://example\\.com/plant/v1/Pump.*')).toBe('plant:Pump.*')
    expect(reg.shorten('https://example.com/plant/v1/Valve')).toBe('plant:Valve')
    expect(reg.shortenPattern('.*Pump')).toBe('.*Pump')
  })

  test('escapes of other characters match them; a trailing backslash ends the literal', () => {
    expect(leadingLiteral('http:\\/\\/ex\\.org\\/a\\-b\\/P.*')).toBe('http://ex.org/a-b/P')
    expect(leadingLiteral('http://ex\\.org/P\\')).toBe('http://ex.org/P')
  })

  test('a pattern that does not hold a whole namespace registers nothing', () => {
    const reg = createRegistry()
    const before = reg.entries().length
    expect(reg.shortenPattern('http://opcfoundation.org/UA/Pumps/P.*')).toBe('http://opcfoundation.org/UA/Pumps/P.*')
    expect(reg.shortenPattern('https://exam.*')).toBe('https://exam.*')
    expect(reg.entries()).toHaveLength(before)
    expect(reg.entries()).toHaveLength(before)
    // Written with escaped slashes, the namespace is still all there.
    expect(reg.shortenPattern('http:\\/\\/opcfoundation\\.org\\/UA\\/Pumps\\/P.*')).toBe('pumps:P.*')
  })
})
