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
 * HTTP access to the backend: base path, JSON, key mapping and error mapping.
 * Every failure becomes a DataError of the calling area.
 */
import { DataError } from '../../errors'
import { fromBackend } from './map'

export const TIMEOUT_MS = 15_000

/** Path prefix of the backend (`VITE_BACKEND_BASE`); empty for the same origin, e.g. through the dev proxy. */
export const basePath = () => (import.meta.env.VITE_BACKEND_BASE ?? '').replace(/\/$/, '')

const KIND_BY_STATUS = { 401: 'unauthorized', 403: 'unauthorized', 404: 'not_found', 409: 'conflict', 422: 'invalid' }

/** The error kind and message of a refused request: the backend's own, or one derived from the status. */
async function refusal(area, response) {
  let body = null
  try {
    body = await response.json()
  } catch {
    // Not JSON: fall back to the status.
  }
  const error = body?.error
  if (error?.kind && error?.message) return new DataError(area, error.kind, error.message)
  const kind = KIND_BY_STATUS[response.status] ?? 'unavailable'
  return new DataError(area, kind, `The backend answered HTTP ${response.status}.`)
}

/** `scanned=5000, total=5300` from the header of a list that stopped early, as numbers. */
function limitOf(header) {
  if (!header) return null
  return Object.fromEntries(header.split(',').map((part) => part.trim().split('=')).map(([k, v]) => [k, Number(v)]))
}

function query(params = {}) {
  const entries = Object.entries(params).filter(([, v]) => v !== undefined && v !== null && v !== '')
  return entries.length ? `?${new URLSearchParams(entries).toString()}` : ''
}

/**
 * Calls the backend and resolves with the mapped JSON result (undefined for an empty answer).
 *   request('runs', 'POST', '/api/agent/run', { body: { machine_id, issue } })
 * With `raw`, keys stay as they are: attribute names are data, and `max_temp` must stay `max_temp`.
 */
export async function request(area, method, path, { params, body, raw = false } = {}) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)
  let response
  try {
    response = await fetch(`${basePath()}${path}${query(params)}`, {
      method,
      headers: body === undefined ? { Accept: 'application/json' } : { Accept: 'application/json', 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: controller.signal,
    })
  } catch (err) {
    const message = err?.name === 'AbortError'
      ? `The backend did not answer within ${TIMEOUT_MS / 1000} s.`
      : 'The backend cannot be reached.'
    throw new DataError(area, 'unavailable', message)
  } finally {
    clearTimeout(timer)
  }
  if (!response.ok) throw await refusal(area, response)
  if (response.status === 204) return undefined
  const text = await response.text()
  if (!text) return undefined
  const result = raw ? JSON.parse(text) : fromBackend(JSON.parse(text))
  const limited = limitOf(response.headers?.get('X-Results-Limited'))
  if (limited && Array.isArray(result)) result.limited = limited
  return result
}

/** A path segment from an identifier. */
export const seg = (id) => encodeURIComponent(String(id))
