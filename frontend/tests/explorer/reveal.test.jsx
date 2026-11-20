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

import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { waitFor } from '@testing-library/react'
import { restoreScroll, revealEntity } from '../../src/features/explorer/DataExplorer'

const ID = 'urn:ngsi-ld:Machine:chiller-01'

/**
 * The entity's node in the page, after a copy of it nested under another entity; its top moves as `tops`
 * says, frame by frame. Not current, it is shown on its own (pinned or unnested).
 */
function node({ current = true, focusedLine = false } = {}) {
  document.body.innerHTML = `
    <article class="entity-node" data-entity="${ID}"></article>
    <article class="entity-node${current ? ' entity-node--current' : ''}" data-entity="${ID}"${current ? '' : ` data-own-place="${ID}"`}>
      <div class="attr-line${focusedLine ? ' attr-line--focused' : ''}"></div>
    </article>`
  const nodes = document.querySelectorAll('.entity-node')
  return { node: nodes[1], copy: nodes[0], line: nodes[1].querySelector('.attr-line') }
}

const nativeRect = Element.prototype.getBoundingClientRect
const nativeScrollBy = window.scrollBy
let tops
let scrolled
let room
beforeEach(() => {
  tops = new Map()
  scrolled = []
  // A named line is centred with scrollIntoView; the entity is moved below the header with scrollBy.
  Element.prototype.scrollIntoView = vi.fn(function scrollIntoView(options) {
    scrolled.push([this, options])
    tops.set(this, 300)
  })
  // Moves everything but the sticky header by `top`, as far as `room` allows (the page's end).
  room = Infinity
  window.scrollBy = vi.fn(({ top }) => {
    const by = Math.min(top, room)
    room -= by
    scrolled.push(['scrollBy', top])
    document.querySelectorAll('body *:not(.app-header)').forEach((el) => tops.set(el, (tops.get(el) ?? 500) - by))
  })
  Element.prototype.getBoundingClientRect = vi.fn(function rect() {
    return { top: tops.get(this) ?? 500, bottom: tops.get(this) ?? 500 }
  })
})
afterEach(() => {
  delete Element.prototype.scrollIntoView
  window.scrollBy = nativeScrollBy
  Element.prototype.getBoundingClientRect = nativeRect
  document.body.innerHTML = ''
})

describe('an entity opened by a link is brought into view', () => {
  test('the current node comes to the top, just below the page', async () => {
    const { node: target } = node()
    const stop = revealEntity(ID, 200)
    await waitFor(() => expect(scrolled).toHaveLength(1))
    expect(scrolled[0]).toEqual(['scrollBy', 500 - 12])
    expect(tops.get(target)).toBe(12)
    stop()
  })

  test('below the sticky header, not under it', async () => {
    const { node: target } = node()
    const header = document.createElement('header')
    header.className = 'app-header'
    document.body.prepend(header)
    tops.set(header, 92)
    const stop = revealEntity(ID, 200)
    await waitFor(() => expect(scrolled).toHaveLength(1))
    expect(scrolled[0]).toEqual(['scrollBy', 500 - 92 - 12])
    expect(tops.get(target)).toBe(92 + 12)
    stop()
  })

  test('a focused attribute line comes to the middle of the space below the header', async () => {
    const { line } = node({ focusedLine: true })
    const stop = revealEntity(ID, 200)
    await waitFor(() => expect(scrolled).toHaveLength(1))
    expect(scrolled[0]).toEqual(['scrollBy', 500 - (12 + window.innerHeight) / 2])
    expect(tops.get(line)).toBe((12 + window.innerHeight) / 2)
    stop()
  })

  test('a move the page\'s end cut short is completed once the page grows', async () => {
    const { node: target } = node()
    room = 100
    const stop = revealEntity(ID, 1000)
    await waitFor(() => expect(tops.get(target)).toBe(400))
    room = Infinity
    await waitFor(() => expect(tops.get(target)).toBe(12))
    stop()
  })

  test('the browser\'s scroll anchoring is off while it runs, and as before afterwards', async () => {
    node()
    document.documentElement.style.overflowAnchor = ''
    const stop = revealEntity(ID, 1000)
    expect(document.documentElement.style.overflowAnchor).toBe('none')
    stop()
    expect(document.documentElement.style.overflowAnchor).toBe('')
  })

  test('a kept position is restored once the page has grown enough for it', async () => {
    let y = 0
    Object.defineProperty(window, 'scrollY', { configurable: true, get: () => y })
    room = 300
    window.scrollBy = vi.fn(({ top }) => {
      const by = Math.min(top, room)
      room -= by
      y += by
    })
    const ended = vi.fn()
    restoreScroll(700, ended)
    await waitFor(() => expect(y).toBe(300))
    expect(ended).not.toHaveBeenCalled()
    room = Infinity
    await waitFor(() => expect(y).toBe(700))
    await waitFor(() => expect(ended).toHaveBeenCalled())
    Object.defineProperty(window, 'scrollY', { configurable: true, value: 0 })
  })

  test('again when content loading above moves it, and not while it stays', async () => {
    const { node: target } = node()
    const stop = revealEntity(ID, 1000)
    await waitFor(() => expect(scrolled).toHaveLength(1))
    await new Promise((resolve) => setTimeout(resolve, 80))
    expect(scrolled).toHaveLength(1)
    tops.set(target, 340)
    await waitFor(() => expect(scrolled).toHaveLength(2))
    expect(scrolled[1]).toEqual(['scrollBy', 340 - 12])
    stop()
  })

  test('not any more once the operator scrolls', async () => {
    const { node: target } = node()
    revealEntity(ID, 1000)
    await waitFor(() => expect(scrolled).toHaveLength(1))
    window.dispatchEvent(new Event('wheel'))
    tops.set(target, 340)
    await new Promise((resolve) => setTimeout(resolve, 80))
    expect(scrolled).toHaveLength(1)
  })

  test('the node shown on its own when none is the current one, never a nested copy', async () => {
    const { node: target, copy } = node({ current: false })
    tops.set(copy, 200)
    const stop = revealEntity(ID, 200)
    await waitFor(() => expect(scrolled).toHaveLength(1))
    expect(scrolled[0]).toEqual(['scrollBy', 500 - 12])
    expect(tops.get(target)).toBe(12)
    stop()
  })

  test('not any more once something else moves the page, such as the scrollbar', async () => {
    const { node: target } = node()
    revealEntity(ID, 1000)
    await waitFor(() => expect(scrolled).toHaveLength(1))
    Object.defineProperty(window, 'scrollY', { configurable: true, value: 300 })
    tops.set(target, 340)
    await new Promise((resolve) => setTimeout(resolve, 80))
    expect(scrolled).toHaveLength(1)
    Object.defineProperty(window, 'scrollY', { configurable: true, value: 0 })
  })
})
