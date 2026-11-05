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

/** Run operations served by the backend (`/api/agent/…`), and the live run stream. */
import { DataError } from '../../errors'
import { basePath, request, seg } from './http'
import { fromBackend, outboundFiles, toBackend } from './map'

const AREA = 'runs'
const path = (op, runId) => `/api/agent/${op}/${seg(runId)}`

/** Delays before reconnecting a lost stream: 0.5 s, 1 s, 2 s, 4 s, then every 8 s. */
export const RECONNECT_DELAYS_MS = [500, 1000, 2000, 4000, 8000]
/** Close code the backend uses for an unknown or archived run. */
export const UNKNOWN_RUN = 4404

/** WebSocket URL for a backend path, on the page's host unless VITE_BACKEND_BASE names another origin. */
export function socketUrl(wsPath) {
  const base = basePath()
  if (/^https?:\/\//.test(base)) return `${base.replace(/^http/, 'ws')}${wsPath}`
  return `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}${base}${wsPath}`
}

/**
 * Streams one run: `snapshot` first, then `step` and `status` events.
 * A lost connection is reported as `{ type: 'connection', state: 'reconnecting' }`
 * and reopened with increasing delays; the next snapshot replaces the screen's state.
 * An unknown or archived run, or a stream that never opened, ends with an `error` event.
 */
export function subscribeRun(runId, onEvent) {
  let socket = null
  let timer = null
  let ended = false
  let attempt = 0
  let live = false

  const end = (kind, message) => {
    if (ended) return
    ended = true
    clearTimeout(timer)
    socket?.close()
    onEvent({ type: 'error', error: new DataError(AREA, kind, message) })
  }

  const connect = () => {
    socket = new WebSocket(socketUrl(`/ws/run/${seg(runId)}`))
    socket.onmessage = (message) => {
      if (ended) return
      let event
      try {
        event = fromBackend(JSON.parse(message.data))
      } catch {
        return
      }
      if (event.type === 'snapshot') {
        live = true
        attempt = 0
        onEvent(event)
      } else if (event.type === 'step' || event.type === 'status') {
        onEvent(event)
      } else if (event.type === 'error') {
        end(event.error?.kind ?? 'unavailable', event.error?.message ?? 'The run stream failed.')
      }
      // Other types (keep-alive) only show that the connection is alive.
    }
    socket.onclose = (closeEvent) => {
      if (ended) return
      if (closeEvent.code === UNKNOWN_RUN) {
        end('not_found', `Run ${runId} is no longer active.`)
      } else if (!live) {
        end('unavailable', 'The live connection to the backend could not be opened.')
      } else {
        onEvent({ type: 'connection', state: 'reconnecting' })
        timer = setTimeout(connect, RECONNECT_DELAYS_MS[Math.min(attempt, RECONNECT_DELAYS_MS.length - 1)])
        attempt += 1
      }
    }
  }

  connect()
  return () => {
    ended = true
    clearTimeout(timer)
    socket?.close()
  }
}

export const runs = {
  listActiveRuns: () => request(AREA, 'GET', '/api/agent/runs'),
  startRun: ({ machineId, issue } = {}) => request(AREA, 'POST', '/api/agent/run', { body: toBackend({ machineId, issue }) }),
  getRun: (runId) => request(AREA, 'GET', path('status', runId)),
  subscribeRun,
  clarify: (runId, { text = '', files = [] } = {}) =>
    request(AREA, 'POST', path('clarify', runId), { body: { text, files: outboundFiles(files) } }),
  confirmResolution: (runId, { confirmed, text = '', files = [] } = {}) =>
    request(AREA, 'POST', path('confirm-resolution', runId), { body: { confirmed: !!confirmed, text, files: outboundFiles(files) } }),
  escalationPreflight: (runId) => request(AREA, 'GET', path('escalate-preflight', runId)),
  reopenRun: (runId) => request(AREA, 'POST', path('reopen', runId)),
  stopRun: (runId, { reason } = {}) => request(AREA, 'POST', path('stop', runId), { body: { reason: reason ?? null } }),
  archiveRun: async (runId) => {
    await request(AREA, 'POST', path('archive', runId))
  },
}
