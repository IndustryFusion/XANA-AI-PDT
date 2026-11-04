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

import { buildSeed, SEED_VERSION } from './seed'

/**
 * In-memory store of the mock source, mirrored to sessionStorage: a reload
 * keeps the operator's changes, a new browser tab starts from the seed.
 */
export const STORE_KEY = 'xana.mock.store.v1'

export function createStore({ storage = globalThis.sessionStorage, now } = {}) {
  let state = load(storage) ?? buildSeed({ now })
  save(storage, state)
  const resetListeners = new Set()

  return {
    get: () => state,
    update(fn) {
      state = fn(structuredClone(state)) ?? state
      save(storage, state)
      return state
    },
    reset() {
      state = buildSeed({ now })
      save(storage, state)
      resetListeners.forEach((l) => l())
    },
    onReset(listener) {
      resetListeners.add(listener)
      return () => resetListeners.delete(listener)
    },
  }
}

function load(storage) {
  try {
    const raw = storage?.getItem(STORE_KEY)
    const parsed = raw ? JSON.parse(raw) : null
    return parsed?.version === SEED_VERSION ? parsed : null
  } catch {
    return null
  }
}

function save(storage, state) {
  try {
    storage?.setItem(STORE_KEY, JSON.stringify(state))
  } catch {
    // Storage full or unavailable: keep working in memory only.
  }
}
