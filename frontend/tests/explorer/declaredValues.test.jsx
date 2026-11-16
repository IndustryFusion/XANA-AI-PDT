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

// Declared values in the Data explorer (gh-84-read-declared-values).
import { render, screen } from '@testing-library/react'
import { describe, expect, test } from 'vitest'

import AttributeValue from '../../src/features/explorer/AttributeValue'
import { attributeKind, editableValue, effectiveDatatype, isNumberText, isValueObject, literalOf, parseInput, sameValue, valueOfDatatype } from '../../src/features/explorer/attributes'

const DOUBLE = 'http://www.w3.org/2001/XMLSchema#double'
const declared = (value) => ({ type: DOUBLE, '@value': value })

describe('reading a declared value', () => {
  test.each([
    [declared(42.5), 42.5],
    [{ '@type': DOUBLE, '@value': 42.5 }, 42.5],
    [declared('42.5'), 42.5],
    [{ type: 'xsd:double', '@value': '42.5' }, 42.5],
    [{ type: 'http://www.w3.org/2001/XMLSchema#integer', '@value': '17' }, 17],
    [{ type: 'http://www.w3.org/2001/XMLSchema#boolean', '@value': 'true' }, true],
    [42.5, 42.5],
    ['00042', '00042'],
    [{ '@value': '00042' }, '00042'],
    [declared('hot'), 'hot'],
  ])('%j reads as %j', (value, expected) => {
    expect(literalOf(value)).toStrictEqual(expected)
  })

  test('IRI references and other objects are not value objects', () => {
    expect(isValueObject({ '@id': 'urn:x' })).toBe(false)
    expect(isValueObject({ '@value': 1, other: 2 })).toBe(false)
    expect(literalOf({ '@id': 'urn:x' })).toEqual({ '@id': 'urn:x' })
  })
})

describe('a declared double in the explorer', () => {
  const attr = { type: 'Property', value: declared(42.5), unitCode: 'CEL' }

  test('is a property shown as its value', () => {
    expect(attributeKind(attr)).toBe('property')
    render(<AttributeValue attr={attr} />)
    expect(screen.getByText('42.5')).toBeInTheDocument()
    expect(screen.queryByText(/XMLSchema/)).not.toBeInTheDocument()
  })

  test('is shown as a number when it arrives as a string', () => {
    render(<AttributeValue attr={{ type: 'Property', value: declared('42.5') }} />)
    expect(screen.getByText('42.5')).toHaveClass('tok--number')
  })

  test('is editable in place, and the input is read as a number', () => {
    const [member, current] = editableValue(attr)
    expect([member, current]).toEqual(['value', 42.5])
    expect(parseInput('80', current, member)).toBe(80)
  })
})

describe('live updates of a declared value', () => {
  test('the same value in another form is not a change', () => {
    expect(sameValue({ type: 'Property', value: 42.5 }, { type: 'Property', value: declared('42.5') })).toBe(true)
    expect(sameValue({ type: 'Property', value: declared(42.5) }, { type: 'Property', value: declared('42.5') })).toBe(true)
  })

  test('a changed value is a change', () => {
    expect(sameValue({ type: 'Property', value: declared(42.5) }, { type: 'Property', value: declared(43) })).toBe(false)
  })
})

const XSD = 'http://www.w3.org/2001/XMLSchema#'

describe('the datatype of a value and its form', () => {
  test.each([
    [80, 'integer'],
    [2.5, 'double'],
    [true, 'boolean'],
    ['on', 'string'],
    [declared(80), 'double'],
    [{ '@value': '2026-11-15T10:00:00Z', '@type': 'xsd:dateTime' }, 'dateTime'],
  ])('%j reads as xsd:%s', (value, local) => {
    expect(effectiveDatatype(value)).toBe(XSD + local)
  })

  test('a string that reads as a number is marked', () => {
    expect(isNumberText('2.7')).toBe(true)
    expect(isNumberText('2.7x')).toBe(false)
    expect(isNumberText(2.7)).toBe(false)
  })

  test.each([
    ['2.5', 'double', { '@value': 2.5, '@type': `${XSD}double` }],
    ['6', 'double', { '@value': 6, '@type': `${XSD}double` }],
    ['2026-11-15T10:00:00Z', 'dateTime', { '@value': '2026-11-15T10:00:00Z', '@type': `${XSD}dateTime` }],
    ['1.25', 'decimal', { '@value': 1.25, '@type': `${XSD}decimal` }],
    ['7', 'integer', 7],
    ['true', 'boolean', true],
    ['on', 'string', 'on'],
    ['ab', 'token', { '@value': 'ab', '@type': `${XSD}token` }],
  ])('%s as xsd:%s is written as %j', (text, local, written) => {
    expect(valueOfDatatype(text, XSD + local)).toStrictEqual(written)
  })

  test.each([['tomorrow', 'dateTime'], ['yes', 'boolean'], ['six', 'double'], ['1.5', 'integer']])('%s is not a value of xsd:%s, and saved anyway it is declared as entered', (text, local) => {
    expect(() => valueOfDatatype(text, XSD + local)).toThrow(`“${text}” is not a value of xsd:${local}.`)
    expect(valueOfDatatype(text, XSD + local, { anyway: true })).toStrictEqual({ '@value': text, '@type': XSD + local })
  })
})
