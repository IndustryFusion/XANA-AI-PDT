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

import { fireEvent, renderHook, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { paths } from '../../src/app/router'
import { areas } from '../../src/data'
import { store } from '../../src/data/sources/mock'
import { expandAllRelationships, resetExplorerState, useExpandingAll } from '../../src/features/explorer/store'
import { renderAppWith } from '../helpers'

const NS = 'http://opcfoundation.org/UA/Pumps/'
const PART = 'urn:test:part'
const PUMP = 'urn:test:pump'
const PLANT = 'urn:test:plant'
const rel = (object, extra = {}) => ({ type: 'Relationship', object, ...extra })
const named = (id, type, name, rest = {}) => ({ id, type, name: { type: 'Property', value: name }, ...rest })

const TREE = [
  named(PART, 'Part', 'Part', { madeOf: rel('urn:test:steel') }),
  named('urn:test:steel', 'Material', 'Steel'),
  named(PUMP, 'Pump', 'Pump', { [`${NS}hasPart`]: [rel(PART, { datasetId: 'urn:d:1' })], other: rel('urn:test:steel') }),
  named(PLANT, 'Plant', 'Plant', { hasPump: rel(PUMP) }),
  named('urn:test:note', 'Note', 'Note', { text: { type: 'Property', value: 'x', about: rel(PART) }, loop: rel('urn:test:note') }),
]
const open = (id, search = '') => renderAppWith(
  () => store.update((s) => { s.entities.push(...structuredClone(TREE)); return s }),
  { path: `${paths.entity(id)}${search}`, controls: { authEnabled: false } },
)
const referrer = (id, scope = document) => scope.querySelector(`[data-referrer="${id}"]`)
const show = async (user, name) => user.click(await screen.findByRole('button', { name: `Show what refers to ${name}` }))

beforeEach(() => resetExplorerState())
afterEach(() => vi.restoreAllMocks())

test('lists the referring entities with the places they refer from, linking to them', async () => {
  const user = userEvent.setup()
  open(PART)
  await show(user, 'Part')
  await screen.findByText('Referenced by (2)')
  expect(within(referrer(PUMP)).getByText('Pump', { selector: '.attr-line__name' })).toBeVisible()
  expect(within(referrer(PUMP)).getByText('Pump', { selector: '.kind-tag *' })).toBeVisible()
  const place = within(referrer(PUMP)).getByRole('link', { name: 'pumps:hasPart[1]' })
  expect(place).toHaveAttribute('href', expect.stringContaining(`focus=${encodeURIComponent(JSON.stringify([`${NS}hasPart`]))}`))
  expect(within(referrer('urn:test:note')).getByRole('link', { name: 'text.about' })).toBeVisible()
  await user.click(place)
  await waitFor(() => expect(document.querySelector(`.entity-node--current[data-entity="${PUMP}"] .attr-line--focused`)).not.toBeNull())
})

test('the way up goes on from an entity expanded in place, and stops at what is shown above', async () => {
  const user = userEvent.setup()
  open(PART)
  await show(user, 'Part')
  await user.click(await screen.findByRole('button', { name: `Expand ${PUMP} in place` }))
  await show(user, 'Pump')
  await user.click(await screen.findByRole('button', { name: `Expand ${PLANT} in place` }))
  await waitFor(() => expect(document.querySelector(`[data-entity="${PLANT}"] [data-attribute="hasPump"]`)).not.toBeNull())
  expect(within(document.querySelector(`[data-entity="${PLANT}"] [data-attribute="hasPump"]`)).getByText('shown above')).toBeVisible()
  await user.click(screen.getByRole('button', { name: 'Collapse all in Part' }))
  expect(screen.queryByText(/^Referenced by/)).toBeNull()
})

test('expanding all relationships goes down only, also when an entity above is open', async () => {
  const user = userEvent.setup()
  open(PART)
  await show(user, 'Part')
  await user.click(await screen.findByRole('button', { name: `Expand ${PUMP} in place` }))
  await user.click(screen.getByRole('button', { name: 'Expand all relationships of Part' }))
  await waitFor(() => expect(document.querySelectorAll('[data-entity="urn:test:steel"]')).toHaveLength(1))
  const pump = document.querySelector(`[data-entity="${PUMP}"]`)
  expect(pump.querySelector('[data-entity="urn:test:steel"]')).toBeNull()
})

test('an entity can be moved out of the list and back', async () => {
  const user = userEvent.setup()
  open(PART)
  await show(user, 'Part')
  await user.click(await screen.findByRole('button', { name: `Expand ${PUMP} in place` }))
  await user.click(await screen.findByRole('button', { name: 'Unnest Pump' }))
  expect(within(referrer(PUMP)).getByRole('button', { name: /^Go to .*moved out/ })).toBeVisible()
  expect(referrer(PUMP).querySelector(`[data-entity="${PUMP}"]`)).toBeNull()
  await user.click(screen.getByRole('button', { name: 'Re-nest Pump' }))
  expect(referrer(PUMP).querySelector(`[data-entity="${PUMP}"]`)).not.toBeNull()
})

test('opens a folded entity, and says when nothing refers to it', async () => {
  const user = userEvent.setup()
  open(PLANT, '?type=Plant')
  await user.click(await screen.findByRole('button', { name: 'Plant', expanded: true }))
  await show(user, 'Plant')
  expect(await screen.findByText('No entity refers to this one.')).toBeVisible()
  expect(screen.getByRole('button', { name: 'Plant', expanded: true })).toBeVisible()
})

test('a reference to itself is marked, not expanded', async () => {
  const user = userEvent.setup()
  open('urn:test:note')
  await show(user, 'Note')
  expect(await within(await waitFor(() => referrer('urn:test:note') ?? Promise.reject(new Error('none')))).findByText('shown above')).toBeVisible()
})

test('says how far the search got, and retries a failed one', async () => {
  const user = userEvent.setup()
  const spy = vi.spyOn(areas.entities, 'listReferrers')
    .mockRejectedValueOnce(Object.assign(new Error('The broker is down.'), { kind: 'unavailable' }))
    .mockResolvedValue(Object.assign([], { limited: { scanned: 20000, total: 30000 } }))
  open(PART)
  await show(user, 'Part')
  await user.click(await screen.findByRole('button', { name: 'Retry' }))
  expect(await screen.findByText(/Only the first 20000 of 30000 entities were searched/)).toBeVisible()
  expect(screen.getByText('No searched entity refers to this one.')).toBeVisible()
  expect(spy).toHaveBeenCalledWith(PART)
})

test('a failed search leaves the entity usable, and a try that succeeds lists what refers', async () => {
  const user = userEvent.setup()
  vi.spyOn(areas.entities, 'listReferrers').mockRejectedValueOnce(Object.assign(new Error('The broker is down.'), { kind: 'unavailable' }))
  open(PART)
  await show(user, 'Part')
  expect(await screen.findByText(/The broker is down/)).toBeVisible()
  expect(document.querySelector('[data-attribute="madeOf"]')).not.toBeNull()
  await user.click(screen.getByRole('button', { name: 'Retry' }))
  await waitFor(() => expect(referrer(PUMP)).not.toBeNull())
})

test('the way up ends at the nesting limit', async () => {
  const user = userEvent.setup()
  const chain = Array.from({ length: 8 }, (_, i) => named(`urn:test:c${i}`, 'Chain', `Chain ${i}`, i ? { up: rel(`urn:test:c${i - 1}`) } : {}))
  renderAppWith(
    () => store.update((s) => { s.entities.push(...chain); return s }),
    { path: paths.entity('urn:test:c0'), controls: { authEnabled: false } },
  )
  for (let i = 0; i < 5; i += 1) {
    await show(user, `Chain ${i}`)
    await user.click(await screen.findByRole('button', { name: `Expand urn:test:c${i + 1} in place` }))
  }
  await show(user, 'Chain 5')
  await waitFor(() => expect(referrer('urn:test:c6')).not.toBeNull())
  expect(within(referrer('urn:test:c6')).getByText('nesting limit')).toBeVisible()
})

test('a relationship to an entity also expanded in the list is expanded, and expanding all upwards goes on', async () => {
  const user = userEvent.setup()
  renderAppWith(() => store.update((s) => {
    s.entities.push(
      named(PART, 'Part', 'Part', { partOf: rel(PUMP) }),
      named(PUMP, 'Pump', 'Pump', { hasPart: rel(PART), other: rel('urn:test:steel') }),
      named('urn:test:steel', 'Material', 'Steel'),
    )
    return s
  }), { path: paths.entity(PART), controls: { authEnabled: false } })
  await show(user, 'Part')
  await waitFor(() => expect(referrer(PUMP)).not.toBeNull())
  await user.click(within(referrer(PUMP)).getByRole('button', { name: `Expand ${PUMP} in place` }))
  await user.click(within(referrer(PUMP)).getByRole('button', { name: 'Expand all relationships of Pump' }))
  await user.click(screen.getByRole('button', { name: 'Expand all relationships of Part' }))
  const own = () => document.querySelector(`.entity-node--current > .entity-node__body > .entity-doc [data-entity="${PUMP}"]`)
  await waitFor(() => expect(own()).not.toBeNull())
  await waitFor(() => expect(referrer(PUMP).querySelector('[data-entity="urn:test:steel"]')).not.toBeNull())
})

test('expanding all of an entity leaves a tree being expanded on the way up alone', () => {
  const up = `${PART}#[]>${PUMP}`
  expandAllRelationships(up, PUMP)
  expandAllRelationships(PART, PART)
  const { result } = renderHook(() => useExpandingAll(up))
  expect(result.current).toBe(`${up}:1`)
})

test('a search that fails when the list is read again is shown beside the list', async () => {
  const user = userEvent.setup()
  open(PART)
  await show(user, 'Part')
  await waitFor(() => expect(referrer(PUMP)).not.toBeNull())
  vi.spyOn(areas.entities, 'listReferrers').mockRejectedValueOnce(Object.assign(new Error('The broker is down.'), { kind: 'unavailable' }))
  await user.click(within(document.querySelector('[data-attribute="madeOf"]')).getByRole('button', { name: 'Delete madeOf' }))
  await user.click(screen.getByRole('button', { name: 'Delete' }))
  expect(await screen.findByText(/out of date: The broker is down/)).toBeVisible()
  expect(referrer(PUMP)).not.toBeNull()
  await user.click(screen.getByRole('button', { name: 'Retry' }))
  await waitFor(() => expect(screen.queryByText(/The broker is down/)).toBeNull())
})

test('an open list is gone, and nothing is searched, at a past moment', async () => {
  const user = userEvent.setup()
  const CHILLER = 'urn:ngsi-ld:Machine:chiller-01'
  renderAppWith(() => {}, { path: paths.entity(CHILLER), controls: { authEnabled: false } })
  await show(user, 'Process chiller 01')
  await screen.findByText(/^Referenced by \(/)
  const spy = vi.spyOn(areas.entities, 'listReferrers')
  fireEvent.change(screen.getByLabelText('View as of'), { target: { value: '2026-11-01T10:00' } })
  await user.click(screen.getByRole('button', { name: 'Show' }))
  await waitFor(() => expect(screen.queryByText(/^Referenced by/)).toBeNull())
  await screen.findAllByRole('button', { name: /^Expand all relationships of/ })
  expect(screen.queryByText(/^Referenced by/)).toBeNull()
  expect(spy).not.toHaveBeenCalled()
})

test('the past offers no such list', async () => {
  const at = new Date(Date.now() - 3600_000).toISOString()
  renderAppWith(() => {}, { path: `${paths.entity('urn:ngsi-ld:Machine:chiller-01')}?at=${encodeURIComponent(at)}`, controls: { authEnabled: false } })
  await screen.findAllByRole('button', { name: /^Expand all relationships of/ })
  expect(screen.queryByRole('button', { name: /^Show what refers to/ })).toBeNull()
})
