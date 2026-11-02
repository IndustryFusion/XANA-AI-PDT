import { attributeKind, editableValue, groupAttributes, parseInput, subAttributesOf } from '../../src/features/explorer/attributes'
import { checkDocument, previewText } from '../../src/features/explorer/ImportDialog'
import { buildExpression, parseExpression, readQuery, toRequest, toSearch } from '../../src/features/explorer/query'

describe('query builder expression', () => {
  test('conditions become an NGSI-LD expression combined with AND or OR', () => {
    const conditions = [
      { attribute: 'status', op: '==', value: 'running' },
      { attribute: 'value', op: '>', value: '30.5' },
      { attribute: 'name', op: '~=', value: '^Laser' },
      { attribute: 'location', op: 'exists', value: '' },
      { attribute: 'note', op: 'missing', value: '' },
      { attribute: '', op: '==', value: 'ignored' },
      { attribute: 'ignored', op: '==', value: ' ' },
    ]
    expect(buildExpression(conditions)).toBe('status=="running";value>30.5;name~="^Laser";location;!note')
    expect(buildExpression(conditions.slice(0, 2), 'or')).toBe('status=="running"|value>30.5')
    expect(buildExpression([{ attribute: 'text', op: '==', value: 'say "hi"; or | not' }])).toBe('text=="say \\"hi\\"; or | not"')
  })

  test('expressions the builder made are parsed back into conditions', () => {
    for (const [conditions, combine] of [
      [[{ attribute: 'status', op: '==', value: 'running' }, { attribute: 'value', op: '>=', value: '5' }], 'and'],
      [[{ attribute: 'text', op: '!=', value: 'a;b|c "d"' }, { attribute: 'x', op: 'exists', value: '' }, { attribute: 'y', op: 'missing', value: '' }], 'or'],
    ]) {
      expect(parseExpression(buildExpression(conditions, combine))).toEqual({ conditions, combine })
    }
  })

  test('expressions beyond the builder are not parsed', () => {
    expect(parseExpression('(a==1|b==2);c==3')).toBeNull()
    expect(parseExpression('a==1|b==2;c==3')).toBeNull()
  })
})

describe('query in the URL', () => {
  test('round trip with defaults left out', () => {
    const query = readQuery({ type: 'Machine', q: 'status=="idle"' })
    expect(query.limit).toBe('50')
    expect(toSearch(query)).toBe('?type=Machine&q=status%3D%3D%22idle%22')
    expect(toRequest(query)).toEqual({ type: 'Machine', q: 'status=="idle"', limit: 50 })
    expect(toSearch(readQuery({}))).toBe('')
  })
})

describe('attributes', () => {
  test('kinds, sub-attributes and editable values', () => {
    expect(attributeKind({ type: 'Property', value: { '@id': 'urn:x:y' } })).toBe('iri')
    expect(attributeKind({ type: 'Property', value: 'https://example.org/a' })).toBe('iri')
    expect(attributeKind({ type: 'Property', value: 3 })).toBe('property')
    expect(attributeKind({ type: 'SomethingNew' })).toBe('other')
    expect(attributeKind([{ type: 'Relationship', object: 'urn:x:y', datasetId: 'a' }])).toBe('relationship')
    const attr = { type: 'Property', value: 1, unitCode: 'C', observedAt: '2026-01-01T00:00:00Z', accuracy: { type: 'Property', value: 0.1 } }
    expect(subAttributesOf(attr).map(([k]) => k)).toEqual(['accuracy'])
    expect(editableValue(attr)).toEqual(['value', 1])
    expect(editableValue({ type: 'GeoProperty', value: {} })).toBeNull()
    expect(parseInput('12.5', 1, 'value')).toBe(12.5)
    expect(parseInput('high', 1, 'value')).toBe('high')
    expect(parseInput('urn:a:b', { '@id': 'urn:x:y' }, 'value')).toEqual({ '@id': 'urn:a:b' })
    expect(groupAttributes({ id: 'x', type: 'T', b: { type: 'Relationship', object: 'urn:a:b' }, a: { type: 'Property', value: 1 } }).map((g) => g.kind)).toEqual(['property', 'relationship'])
  })
})

describe('import preview', () => {
  test('accepts a list or a single entity and reports problems per entry', () => {
    expect(checkDocument({ id: 'urn:a:b', type: 'T' }).problems).toEqual([])
    expect(checkDocument([]).problems).toEqual(['The document contains no entities.'])
    expect(checkDocument('text').problems).toHaveLength(1)
    expect(checkDocument([{ id: 'urn:a:b', type: 'T' }, { id: 'nope', type: 'T' }, 5]).problems).toHaveLength(2)
    expect(previewText('{', 'f.json').problems[0]).toMatch(/^The file is not valid JSON/)
  })
})
