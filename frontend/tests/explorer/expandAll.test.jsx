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

import { beforeEach, describe, expect, test } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import {
  claimTargets, collapseAll, expandAllRelationships, resetExplorerState, takeLine, unnest, useExpandingAll, useKept,
} from '../../src/features/explorer/store'

// Keys as the explorer builds them: a node's key, its lines `<node>#<level as JSON>`, a target expanded in place
// `<line>><entity>`.
const line = (node, name) => `${node}#${JSON.stringify([name])}`
const kept = (key, initial) => renderHook(() => useKept(key, initial)).result

beforeEach(() => resetExplorerState())

describe('the tree of a node', () => {
  test('an entity whose ID only starts with another one\'s and a # is not part of its tree', () => {
    const plant = 'https://ex.org/plant'
    const own = kept(`${line(plant, 'a')}|subs`, true)
    const other = kept(`${line(`${plant}#line1`, 'a')}|subs`, true)
    act(() => collapseAll(plant))
    expect(own.current[0]).toBe(false)
    expect(other.current[0]).toBe(true)
    act(() => expandAllRelationships(plant, plant))
    expect(renderHook(() => useExpandingAll(`${plant}#line1`)).result.current).toBeNull()
    expect(renderHook(() => useExpandingAll(`${line(plant, 'a')}>urn:t`)).result.current).toBe(`${plant}:1`)
  })

  test('an entity moved out of the tree is outside it for collapse all and expand all', () => {
    const root = 'urn:root'
    const rel = line(root, 'has')
    const moved = `${rel}>urn:b`
    const inside = kept(`${line(moved, 'x')}|subs`, true)
    act(() => unnest('urn:b', { key: rel, level: rel, parent: root, attribute: '["has"]' }))
    act(() => collapseAll(root))
    expect(inside.current[0]).toBe(true)
    act(() => expandAllRelationships(root, root))
    expect(renderHook(() => useExpandingAll(moved)).result.current).toBeNull()
    // Expanding all on the moved-out entity itself still works inside it.
    act(() => expandAllRelationships(moved, 'urn:b'))
    expect(renderHook(() => useExpandingAll(line(moved, 'x'))).result.current).toBe(`${moved}:1`)
  })
})

describe('expanding all', () => {
  test('each entity once: entities already shown in the tree, also by hand, are not expanded again', () => {
    const byHand = kept(`${line('urn:r', 'a')}|nested`, ['urn:x'])
    expect(byHand.current[0]).toEqual(['urn:x'])
    act(() => expandAllRelationships('urn:r', 'urn:r'))
    expect(claimTargets(`${line('urn:r', 'b')}>urn:y`, ['urn:x', 'urn:y', 'urn:r'])).toEqual(['urn:y'])
  })

  test('expand all again expands the tree anew: lines once more, entities not twice', () => {
    const key = line('urn:r', 'a')
    const state = renderHook(() => useExpandingAll(key)).result
    act(() => expandAllRelationships('urn:r', 'urn:r'))
    expect(state.current).toBe('urn:r:1')
    expect(takeLine('urn:r', key)).toBe(true)
    expect(takeLine('urn:r', key)).toBe(false)
    const shown = kept(`${key}|nested`, [])
    act(() => shown.current[1](['urn:x']))
    act(() => expandAllRelationships('urn:r', 'urn:r'))
    expect(state.current).toBe('urn:r:2')
    expect(takeLine('urn:r', key)).toBe(true)
    expect(claimTargets('urn:r', ['urn:x', 'urn:z'])).toEqual(['urn:z'])
  })

  test('expand all on an entity inside a tree being expanded works in its own tree', () => {
    act(() => expandAllRelationships('urn:r', 'urn:r'))
    const nested = `${line('urn:r', 'a')}>urn:n`
    const inner = line(nested, 'b')
    expect(takeLine(nested, inner)).toBe(true)
    act(() => expandAllRelationships(nested, 'urn:n'))
    expect(renderHook(() => useExpandingAll(inner)).result.current).toBe(`${nested}:1`)
    expect(takeLine(nested, inner)).toBe(true)
  })

  test('expand all again takes over a tree being expanded inside it', () => {
    act(() => expandAllRelationships('urn:r', 'urn:r'))
    const nested = `${line('urn:r', 'a')}>urn:n`
    const inner = line(nested, 'b')
    act(() => expandAllRelationships(nested, 'urn:n'))
    expect(takeLine(nested, inner)).toBe(true)
    expect(claimTargets(inner, ['urn:x'])).toEqual(['urn:x'])
    act(() => expandAllRelationships('urn:r', 'urn:r'))
    expect(renderHook(() => useExpandingAll(inner)).result.current).toBe('urn:r:2')
    expect(takeLine(nested, inner)).toBe(true)
    expect(claimTargets('urn:r', ['urn:n'])).toEqual(['urn:n'])
  })

  test('collapse all keeps a moved-out entity in its origin line, so re-nesting brings it back', () => {
    const rel = line('urn:r', 'has')
    const targets = kept(`${rel}|nested`, ['urn:b', 'urn:c'])
    act(() => unnest('urn:b', { key: rel, level: rel, parent: 'urn:r', attribute: '["has"]' }))
    act(() => collapseAll('urn:r'))
    expect(targets.current[0]).toEqual(['urn:b'])
  })

  test('the explorer\'s reset forgets the trees', () => {
    act(() => expandAllRelationships('urn:r', 'urn:r'))
    expect(claimTargets('urn:r', ['urn:x'])).toEqual(['urn:x'])
    act(() => resetExplorerState())
    expect(claimTargets('urn:r', ['urn:x'])).toEqual(['urn:x'])
    expect(takeLine('urn:r', line('urn:r', 'a'))).toBe(false)
  })
})
