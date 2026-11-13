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

import { useCallback, useSyncExternalStore } from 'react'

/**
 * The Data explorer's view state, kept outside the components so it outlives
 * the area being unmounted: leaving the explorer and coming back shows the
 * same results, expansions, unnested entities, pins and scroll position.
 * The query itself is in the URL. Pins are also kept in `localStorage`, so
 * they survive a reload; everything else starts afresh on a reload.
 */

export const PINS_KEY = 'xana.explorer.pins'

function readPins() {
  try {
    const list = JSON.parse(localStorage.getItem(PINS_KEY) ?? '[]')
    return Array.isArray(list) ? list.filter((id) => typeof id === 'string') : []
  } catch {
    return []
  }
}

function writePins(pins) {
  try {
    localStorage.setItem(PINS_KEY, JSON.stringify(pins))
  } catch {
    // Storage can be full or blocked; the pins then last until the page is reloaded.
  }
}

const fresh = () => ({
  kept: new Map(),
  results: null,
  unnested: [],
  pins: readPins(),
  selection: [],
  scroll: null,
  queryKey: null,
})

let state = fresh()
const listeners = new Set()

function emit() {
  state = { ...state }
  listeners.forEach((fn) => fn())
}

const subscribe = (fn) => { listeners.add(fn); return () => listeners.delete(fn) }

/** Starts again as after a reload (pins are read again from storage). */
export function resetExplorerState() {
  state = fresh()
  listeners.forEach((fn) => fn())
}

/* ── Kept values ─────────────────────────────────────────────────────── */

/** A value kept under `key`, like `useState`, that survives the explorer being unmounted. */
export function useKept(key, initial) {
  const value = useSyncExternalStore(subscribe, () => {
    if (!state.kept.has(key)) state.kept.set(key, initial)
    return state.kept.get(key)
  })
  const set = useCallback((next) => {
    const current = state.kept.has(key) ? state.kept.get(key) : initial
    const value = typeof next === 'function' ? next(current) : next
    if (value === current) return
    state.kept.set(key, value)
    emit()
  }, [key]) // eslint-disable-line react-hooks/exhaustive-deps
  return [value, set]
}

/* ── Results ─────────────────────────────────────────────────────────── */

/** The last result list for the request `key`, shown at once on return while it is read again. */
export const keptResults = (key) => (state.results?.key === key ? state.results.data : undefined)
export function keepResults(key, data) {
  if (data === undefined || (state.results?.key === key && state.results.data === data)) return
  state.results = { key, data }
}

/** A new query: unnested entities go (pinned ones stay listed among the pins). */
export function startQuery(key) {
  if (state.queryKey === key) return
  const first = state.queryKey === null
  state.queryKey = key
  if (!first && state.unnested.length) {
    state.unnested = []
    emit()
  }
}

/* ── Scroll ──────────────────────────────────────────────────────────── */

export const keptScroll = () => state.scroll
export const keepScroll = (y) => { state.scroll = y }

/* ── Unnested entities ───────────────────────────────────────────────── */

const useSlice = (pick) => useSyncExternalStore(subscribe, () => pick(state))

export const useUnnested = () => useSlice((s) => s.unnested)

/** Moves an entity expanded under `origin` (`{ parent, attribute }`) to its own place after the results. */
export function unnest(id, origin) {
  if (state.unnested.some((u) => u.id === id)) return
  state.unnested = [...state.unnested, { id, origin }]
  emit()
}

export function renest(id) {
  state.unnested = state.unnested.filter((u) => u.id !== id)
  emit()
}

/* ── Pins ────────────────────────────────────────────────────────────── */

export const usePins = () => useSlice((s) => s.pins)
export const useSelection = () => useSlice((s) => s.selection)

export function pin(id) {
  if (state.pins.includes(id)) return
  state.pins = [...state.pins, id]
  writePins(state.pins)
  emit()
}

export function unpin(ids) {
  const gone = [].concat(ids)
  state.pins = state.pins.filter((id) => !gone.includes(id))
  state.selection = state.selection.filter((id) => !gone.includes(id))
  writePins(state.pins)
  emit()
}

export function toggleSelected(id, on) {
  const has = state.selection.includes(id)
  if (on === has) return
  state.selection = on ? [...state.selection, id] : state.selection.filter((x) => x !== id)
  emit()
}
