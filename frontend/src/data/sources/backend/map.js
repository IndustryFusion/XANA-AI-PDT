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
 * Key mapping between the backend (snake_case) and the UI data interface
 * (camelCase). Only keys change, recursively, also inside step input and
 * output and state data; values such as the operator's text are never altered.
 */

const toCamelKey = (key) => key.replace(/_([a-z0-9])/g, (_, c) => c.toUpperCase())
const toSnakeKey = (key) => key.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`)

function mapKeys(value, mapKey) {
  if (Array.isArray(value)) return value.map((item) => mapKeys(item, mapKey))
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [mapKey(k), mapKeys(v, mapKey)]))
  }
  return value
}

/** A backend response in interface terms. */
export const fromBackend = (value) => mapKeys(value, toCamelKey)

/** A request body in backend terms. */
export const toBackend = (value) => mapKeys(value, toSnakeKey)

/** Attached files as the backend takes them: `{ name, type, size, data_url }`. */
export const outboundFiles = (files = []) =>
  files.map(({ name, type, size, dataUrl }) => ({ name, type, size, data_url: dataUrl }))
