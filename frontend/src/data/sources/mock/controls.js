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

import { DataError } from '../../errors'

/**
 * Development controls of the mock source: per-area latency and failure,
 * mock authentication, dataspace state and gateway, the scenario and playback speed
 * of simulated runs, live entity updates and occasional new alerts. Stored in localStorage so tests
 * can preset them before the app loads. Ignored in production builds.
 */
export const CONTROLS_KEY = 'xana.mock.controls'

export const FAILURE_MODES = ['none', 'unavailable', 'unauthorized']

export const DEFAULT_CONTROLS = {
  latencyMs: {},
  failure: {},
  authEnabled: true,
  // Preset dataspace connection state (null: the state the mock keeps, changed by connect and
  // disconnect, which also clear this preset), whether the gateway can be reached, and whether
  // the configuration provides the dataspace credential.
  connection: null,
  gatewayReachable: true,
  credentialConfigured: false,
  // Bumped to invalidate the current mock session ("Expire session now").
  sessionRevision: 0,
  // Scenario of the next started run, and playback speed of simulated runs.
  scenario: 'happy_path',
  speed: 1,
  // Live entity updates (available | unavailable) and occasional new alerts.
  liveUpdates: 'available',
  newAlerts: true,
  // How many items a search looks through before it stops and says so (null: no limit), as the
  // backend does on a large installation.
  searchCap: null,
}

/** Playback speeds offered in the controls (multiples of real time). */
export const SPEEDS = [0.5, 1, 2, 5, 10, 25]

const listeners = new Set()

export function readControls(storage = globalThis.localStorage) {
  try {
    const raw = storage?.getItem(CONTROLS_KEY)
    return { ...DEFAULT_CONTROLS, ...(raw ? JSON.parse(raw) : {}) }
  } catch {
    return { ...DEFAULT_CONTROLS }
  }
}

export function writeControls(patch, storage = globalThis.localStorage) {
  const next = { ...readControls(storage), ...patch }
  storage?.setItem(CONTROLS_KEY, JSON.stringify(next))
  listeners.forEach((l) => l(next))
  return next
}

export function onControlsChange(listener) {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

const BASE_LATENCY_MS = 120
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

/** Controls in effect: the stored ones in development, the defaults otherwise. */
export function currentControls() {
  return import.meta.env.DEV ? readControls() : DEFAULT_CONTROLS
}

/** Applied before every mock operation of `area`. */
export async function applyControls(area) {
  const controls = currentControls()
  const extra = Number(controls.latencyMs[area] ?? 0)
  const delay = import.meta.env.MODE === 'test' ? extra : BASE_LATENCY_MS + extra
  if (delay > 0) await sleep(delay)
  const failure = controls.failure[area] ?? 'none'
  if (failure !== 'none') {
    const message = failure === 'unauthorized'
      ? `Access to ${area} was denied (simulated).`
      : `${area} is unavailable (simulated failure).`
    throw new DataError(area, failure, message)
  }
}
