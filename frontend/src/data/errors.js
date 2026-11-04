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

/** Error kinds every data source uses when an operation fails. */
export const ERROR_KINDS = ['unavailable', 'not_found', 'conflict', 'invalid', 'unauthorized']

/**
 * The only error type screens see from the data interface.
 * `area` names the interface area, `kind` is one of ERROR_KINDS.
 */
export class DataError extends Error {
  constructor(area, kind, message) {
    super(message)
    this.name = 'DataError'
    this.area = area
    this.kind = ERROR_KINDS.includes(kind) ? kind : 'unavailable'
  }
}

/** Wraps anything thrown by a data source into a DataError of that area. */
export function toDataError(area, err) {
  if (err instanceof DataError) return err
  return new DataError(area, 'unavailable', err?.message || 'The data source did not respond.')
}
