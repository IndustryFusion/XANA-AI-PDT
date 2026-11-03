import { buildSeed } from './seed'

/**
 * In-memory store of the mock source, mirrored to sessionStorage: a reload
 * keeps the operator's changes, a new browser tab starts from the seed.
 */
export const STORE_KEY = 'xana.mock.store.v1'

export function createStore({ storage = globalThis.sessionStorage, now } = {}) {
  let state = load(storage) ?? buildSeed({ now })
  save(storage, state)

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
    },
  }
}

function load(storage) {
  try {
    const raw = storage?.getItem(STORE_KEY)
    const parsed = raw ? JSON.parse(raw) : null
    return parsed?.version === 1 ? parsed : null
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
