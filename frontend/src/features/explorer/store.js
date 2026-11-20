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
import { onSessionEnd } from '../../app/lastPath'
import { registry } from './prefixes'

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
  expandingAll: [],
  expandedInTree: new Map(),
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

// Kept results, expansions and names belong to the operator who saw them. Pins are kept per
// browser, as the spec says, so they stay.
onSessionEnd(() => {
  resetExplorerState()
  registry.reset()
})

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

/** The kept scroll position and the address (path and search) it was kept at, as `{ address, y }`, or null. */
export const keptScroll = () => state.scroll
export const keepScroll = (address, y) => { state.scroll = { address, y } }

/* ── Collapse and expand all ─────────────────────────────────────────── */

/**
 * Whether a line or node key lies in the tree of the node `nodeKey`: its own lines and everything nested
 * below. A line's key continues the node's key with `#` and its level as a JSON array, so another entity
 * whose ID merely starts with the same characters and a `#` is not taken for part of it.
 */
const inTree = (key, nodeKey) => key === nodeKey || key.startsWith(`${nodeKey}#[`)

/** The node keys of the entities moved out of the tree: they keep their key under their origin. */
const unnestedKeys = () => state.unnested.map((u) => `${u.origin?.key}>${u.id}`)

/** Whether `key` belongs to the tree of `root`: in it, and not inside an entity moved out below the root. */
const belongs = (key, root) => inTree(key, root) && !unnestedKeys().some((u) => inTree(key, u) && !inTree(root, u))

/**
 * Collapses everything inside the node `nodeKey`: the sub-attributes of every line, every target expanded in
 * place, and the raw JSON and history panes, at any depth, and stops expanding all there. The node itself
 * stays open, and so does an entity moved out of the tree.
 */
export function collapseAll(nodeKey) {
  for (const key of [...state.kept.keys()]) {
    // A line's sub-attributes and expanded targets: `<line key>|subs`, `<line key>|nested`.
    if (belongs(key, nodeKey) && key.endsWith('|subs')) state.kept.set(key, false)
    else if (belongs(key, nodeKey) && key.endsWith('|nested')) {
      // An entity moved out from this line keeps its place here, so that re-nesting it brings it back.
      const lineKey = key.slice(0, -'|nested'.length)
      const movedOut = state.unnested.filter((u) => u.origin?.key === lineKey).map((u) => u.id)
      state.kept.set(key, (state.kept.get(key) ?? []).filter((target) => movedOut.includes(target)))
    }
    // A node's raw JSON and history pane: `<time-shift>|<node key>|raw`, `<time-shift>|<node key>|history`.
    else if (/\|(raw|history)$/.test(key) && belongs(key.slice(key.indexOf('|') + 1, key.lastIndexOf('|')), nodeKey)) {
      state.kept.set(key, key.endsWith('|raw') ? false : null)
    }
  }
  state.expandingAll.filter((root) => belongs(root, nodeKey)).forEach((root) => state.expandedInTree.delete(root))
  state.expandingAll = state.expandingAll.filter((root) => !belongs(root, nodeKey))
  emit()
}

/**
 * Collapse all on an entity expanded in place under a relationship: everything inside it, and the entity
 * itself, so its relationship shows as the one line it was before.
 */
export function collapseNested(nodeKey, origin, id) {
  collapseAll(nodeKey)
  const key = `${origin.key}|nested`
  const list = state.kept.get(key)
  if (Array.isArray(list) && list.includes(id)) {
    state.kept.set(key, list.filter((target) => target !== id))
    emit()
  }
}

/** The entities already expanded in place in the tree of `root`: the targets of its lines' kept lists. */
const expandedBelow = (root) => [...state.kept.entries()]
  .filter(([key, list]) => key.endsWith('|nested') && Array.isArray(list) && belongs(key.slice(0, -'|nested'.length), root))
  .flatMap(([, list]) => list)

/**
 * Expands every relationship target in place inside the node `nodeKey` (of the entity `id`), and those of the
 * targets, as they load; each entity once in that tree. Asked for again, it starts the tree anew: its lines
 * expand again, and the entities already shown in it, also those expanded by hand, are not expanded twice.
 * The tree is kept in the explorer's state, with a generation that tells its lines to expand again.
 */
export function expandAllRelationships(nodeKey, id) {
  // The trees being expanded below this node become part of its tree again.
  state.expandingAll.filter((root) => root !== nodeKey && belongs(root, nodeKey)).forEach((root) => state.expandedInTree.delete(root))
  state.expandingAll = state.expandingAll.filter((root) => root === nodeKey || !belongs(root, nodeKey))
  if (!state.expandingAll.includes(nodeKey)) state.expandingAll = [...state.expandingAll, nodeKey]
  const generation = (state.expandedInTree.get(nodeKey)?.generation ?? 0) + 1
  state.expandedInTree.set(nodeKey, { entities: new Set([id, ...expandedBelow(nodeKey)]), lines: new Set(), generation })
  emit()
}

/** The innermost tree being expanded that the node `nodeKey` belongs to, as its root key, or null. */
const rootOf = (nodeKey) => state.expandingAll
  .filter((root) => belongs(nodeKey, root))
  .reduce((inner, root) => (inner === null || root.length > inner.length ? root : inner), null)

const treeOf = (nodeKey) => {
  const root = rootOf(nodeKey)
  return root ? state.expandedInTree.get(root) : null
}

/**
 * Whether the line (or node) `lineKey` of the node `nodeKey` expands now, in the tree being expanded: once per
 * tree and generation, however often it mounts again, so what the operator folded afterwards stays folded.
 */
export function takeLine(nodeKey, lineKey) {
  const tree = treeOf(nodeKey)
  if (!tree || tree.lines.has(lineKey)) return false
  tree.lines.add(lineKey)
  return true
}

/** Of `targets` under the node `nodeKey`, the ones not yet expanded in its expand-all tree, now taken as expanded. */
export function claimTargets(nodeKey, targets) {
  const tree = treeOf(nodeKey)
  if (!tree) return targets
  const fresh = targets.filter((target) => !tree.entities.has(target))
  fresh.forEach((target) => tree.entities.add(target))
  return fresh
}

/**
 * The tree being expanded that the node `nodeKey` belongs to, as `<root>:<generation>`, or null: it changes
 * when expand all is asked for again, so the lines expand again.
 */
export const useExpandingAll = (nodeKey) => useSyncExternalStore(subscribe, () => {
  const root = rootOf(nodeKey)
  return root ? `${root}:${state.expandedInTree.get(root)?.generation ?? 0}` : null
})

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
