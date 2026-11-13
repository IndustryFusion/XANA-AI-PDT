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
import { attributeKind, editableValue, isValueObject, literalOf, parseInput, sameValue } from '../../src/features/explorer/attributes'

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
