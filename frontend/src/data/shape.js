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
 * Minimal runtime shape checker for data-interface results. Used by the
 * data-interface tests; any future data source must pass the same checks.
 *
 * Shape notation:
 *   'string' | 'number' | 'boolean' | 'date'   (date = ISO 8601 string)
 *   '?string' etc.                             (also accepts null or undefined)
 *   [shape]                                    array of shape
 *   { key: shape }                             object with at least these keys
 *   { $enum: [...] } / { $optional: shape }    enum value / optional anything
 *   { $record: shape }                         object whose values all match shape
 */
export function checkShape(value, shape, path = '$') {
  const errors = []
  visit(value, shape, path, errors)
  return errors
}

function visit(value, shape, path, errors) {
  if (typeof shape === 'string') {
    const optional = shape.startsWith('?')
    const type = optional ? shape.slice(1) : shape
    if (value === null || value === undefined) {
      if (!optional) errors.push(`${path}: expected ${type}, got ${value}`)
      return
    }
    if (type === 'date') {
      if (typeof value !== 'string' || Number.isNaN(Date.parse(value))) errors.push(`${path}: expected ISO date, got ${JSON.stringify(value)}`)
      return
    }
    if (typeof value !== type) errors.push(`${path}: expected ${type}, got ${typeof value}`)
    return
  }

  if (Array.isArray(shape)) {
    if (!Array.isArray(value)) { errors.push(`${path}: expected array`); return }
    value.forEach((item, i) => visit(item, shape[0], `${path}[${i}]`, errors))
    return
  }

  if (shape && typeof shape === 'object') {
    if ('$optional' in shape) {
      if (value !== null && value !== undefined) visit(value, shape.$optional, path, errors)
      return
    }
    if ('$enum' in shape) {
      if (!shape.$enum.includes(value)) errors.push(`${path}: ${JSON.stringify(value)} is not one of ${shape.$enum.join(', ')}`)
      return
    }
    if (value === null || typeof value !== 'object' || Array.isArray(value)) { errors.push(`${path}: expected object`); return }
    if ('$record' in shape) {
      for (const [k, v] of Object.entries(value)) visit(v, shape.$record, `${path}.${k}`, errors)
      return
    }
    for (const [k, s] of Object.entries(shape)) visit(value[k], s, `${path}.${k}`, errors)
  }
}
