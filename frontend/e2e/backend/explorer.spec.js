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

// The Data Explorer on the backend data source, against a real context broker and PostgREST
// (the local environment with its `history` profile) and the sample data.
import { test, expect } from '@playwright/test'
import { presetControls } from '../helpers'

const MACHINE = 'urn:ngsi-ld:Machine:laser-cutter-01'
const SENSOR = 'urn:ngsi-ld:Sensor:laser-cutter-01-temperature'
const entities = (page) => page.getByRole('region', { name: 'Entities' })
const node = (page, id) => page.locator(`[data-entity="${id}"]`).first()
const attribute = (scope, name) => scope.locator(`[data-attribute="${name}"]`).first()
const tag = () => Date.now().toString(36)

test.beforeEach(async ({ page }) => {
  await presetControls(page, { authEnabled: false })
})

async function create(page, entity) {
  const answer = await page.request.post('/api/ngsi/import', { data: [entity] })
  expect(answer.status()).toBe(200)
}

async function open(page, id) {
  await page.goto(`/explorer/${encodeURIComponent(id)}?id=${encodeURIComponent(id)}`)
  await expect(node(page, id)).toBeVisible()
}

test('types and attributes come from the broker, and a query lists its machines', async ({ page }) => {
  await page.goto('/explorer')
  await page.getByLabel('Entity type').fill('Machine')
  await page.getByRole('button', { name: 'More filters' }).click()
  await page.getByRole('button', { name: 'Add condition' }).click()
  await page.getByLabel('Attribute of condition 1').selectOption('machineType')
  await page.getByLabel('Value of condition 1').fill('LaserCutter')
  await page.getByRole('button', { name: 'Search' }).click()
  await expect(node(page, MACHINE)).toBeVisible()
  await expect(entities(page).locator('[data-entity="urn:ngsi-ld:Machine:press-brake-01"]')).toHaveCount(0)
})

test('pattern, range and missing conditions work on a real broker', async ({ page }) => {
  for (const q of ['machineType~="^Laser"', 'machineType!~="^Press"', '!nothing', 'name;!nothing']) {
    await page.goto(`/explorer?type=Machine&limit=100&q=${encodeURIComponent(q)}`)
    await expect(node(page, MACHINE)).toBeVisible()
  }
})

test('an invalid expression is explained next to the query bar', async ({ page }) => {
  await page.goto(`/explorer?type=Machine&q=${encodeURIComponent('((')}`)
  await expect(page.getByRole('alert').filter({ hasText: 'position' })).toBeVisible()
})

test('edit a value in place, and it stays after a reload', async ({ page }) => {
  const id = `urn:ngsi-ld:E2e:${tag()}`
  await create(page, { id, type: 'E2e', note: { type: 'Property', value: 'old' }, level: { type: 'Property', value: 3, unitCode: 'CEL' } })
  try {
    await open(page, id)
    await attribute(node(page, id), 'note').getByRole('button', { name: /old/ }).click()
    await page.getByLabel('New value of note').fill('new text')
    await page.getByLabel('New value of note').press('Enter')
    // The save has to be over: a reload would otherwise cut it off.
    await expect(page.getByLabel('New value of note')).toHaveCount(0)
    await page.reload()
    await expect(attribute(node(page, id), 'note')).toContainText('new text')

    await attribute(node(page, id), 'level').getByRole('button', { name: /3/ }).first().click()
    await page.getByLabel('New value of level').fill('abc')
    await page.getByLabel('New value of level').press('Enter')
    await expect(page.getByRole('alert').filter({ hasText: 'Not saved' })).toContainText('must be a number')
  } finally {
    await page.request.delete(`/api/ngsi/entities/${encodeURIComponent(id)}`)
  }
})

test('import from a file, with a result per entity, then delete by type', async ({ page }) => {
  const kind = `E2eBulk${tag()}`
  const document = [{ id: `urn:ngsi-ld:${kind}:1`, type: kind }, { id: `urn:ngsi-ld:${kind}:2`, type: kind, broken: { type: 'Nonsense' } }]
  await page.goto('/explorer')
  await page.getByRole('button', { name: 'Import…' }).click()
  await page.getByLabel(/File with NGSI-LD entities/).setInputFiles({ name: 'e.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(document)) })
  await page.getByRole('button', { name: 'Import 2 entities' }).click()
  await expect(page.getByRole('status').filter({ hasText: 'Import finished' })).toContainText('created')
  await page.getByRole('button', { name: 'Done' }).click()

  const answer = await page.request.post('/api/ngsi/delete-by-types', { data: { types: [kind] } })
  expect((await answer.json())[0].count).toBeGreaterThan(0)
})

test('import from an internal address is refused with the reason', async ({ page }) => {
  await page.goto('/explorer')
  await page.getByRole('button', { name: 'Import…' }).click()
  await page.getByRole('radio', { name: 'URL' }).check()
  await page.getByLabel('Document URL').fill('http://169.254.169.254/latest/meta-data')
  await page.getByRole('button', { name: 'Fetch' }).click()
  await expect(page.getByRole('alert').filter({ hasText: 'internal address' })).toBeVisible()
})

test('import refuses a context that is not allowed, and says why, without the address', async ({ page }) => {
  await page.goto('/explorer')
  await page.getByRole('button', { name: 'Import…' }).click()
  const document = [{ '@context': 'http://169.254.169.254/x.jsonld', id: `urn:ngsi-ld:E2e:${tag()}`, type: 'E2e' }]
  await page.getByLabel(/File with NGSI-LD entities/).setInputFiles({ name: 'e.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(document)) })
  await page.getByRole('button', { name: 'Import 1 entities' }).click()
  const results = page.getByRole('region', { name: 'Import results' })
  await expect(results).toContainText("isn't allowed")
  await expect(results).not.toContainText('169.254')
})

test('history of a signal, through PostgREST', async ({ page }) => {
  await open(page, SENSOR)
  await attribute(node(page, SENSOR), 'value').getByRole('button', { name: /history/i }).click()
  await expect(page.getByRole('region', { name: 'Values of value' })).toBeVisible()
  await expect(page.getByRole('region', { name: 'Values of value' }).locator('tbody tr').first()).toBeVisible()
})

test('time-shift shows the machine as it was', async ({ page }) => {
  const at = new Date(Date.now() - 12 * 3600_000).toISOString()
  await page.goto(`/explorer/${encodeURIComponent(MACHINE)}?type=Machine&at=${encodeURIComponent(at)}`)
  await expect(page.getByRole('region', { name: 'Historical view' })).toBeVisible()
  await expect(node(page, MACHINE)).toBeVisible()
  await expect(attribute(node(page, MACHINE), 'status')).toBeVisible()
})

test('the history of a deleted attribute says so, and still shows its values', async ({ page }) => {
  await page.route('**/api/ngsi/attr-status**', (route) => route.fulfill({ json: { 'https://uri.etsi.org/ngsi-ld/default-context/value': { deleted: true, observedAt: '2026-11-01T10:00:00Z' } } }))
  await open(page, SENSOR)
  await attribute(node(page, SENSOR), 'value').getByRole('button', { name: /history/i }).click()
  await expect(page.getByRole('status').filter({ hasText: 'This attribute was deleted' })).toBeVisible()
  await expect(page.getByRole('region', { name: 'Values of value' }).locator('tbody tr').first()).toBeVisible()
})

test('statuses of PostgREST and the broker are told apart in errors', async ({ page }) => {
  await page.route('**/api/ngsi/history**', (route) => route.fulfill({ status: 502, json: { error: { kind: 'unavailable', message: 'The history service (PostgREST) cannot be reached (ConnectError).' } } }))
  await open(page, SENSOR)
  await attribute(node(page, SENSOR), 'value').getByRole('button', { name: /history/i }).click()
  await expect(page.getByRole('alert').filter({ hasText: 'Could not load the history' })).toContainText('PostgREST')
})


test('a declared double is shown as its value and keeps its datatype when edited', async ({ page }) => {
  // gh-84-read-declared-values: the platform writes doubles as {"@value": …, "@type": "…#double"}.
  const DOUBLE = 'http://www.w3.org/2001/XMLSchema#double'
  const id = `urn:ngsi-ld:E2e:${tag()}`
  await create(page, { id, type: 'E2e', temp: { type: 'Property', value: { '@value': 42.5, '@type': DOUBLE }, unitCode: 'CEL' } })
  try {
    await open(page, id)
    await expect(attribute(node(page, id), 'temp')).toContainText('42.5')
    await expect(attribute(node(page, id), 'temp')).not.toContainText('XMLSchema')

    await attribute(node(page, id), 'temp').getByRole('button', { name: /42\.5/ }).first().click()
    await page.getByLabel('New value of temp').fill('80')
    await page.getByLabel('New value of temp').press('Enter')
    await expect(page.getByLabel('New value of temp')).toHaveCount(0)
    await page.reload()
    await expect(attribute(node(page, id), 'temp')).toContainText('80')

    const stored = await (await page.request.get(`/api/ngsi/entities/${encodeURIComponent(id)}`)).json()
    expect(stored.temp.value['@value']).toBe(80)
    expect(stored.temp.value.type ?? stored.temp.value['@type']).toBe(DOUBLE)

    await attribute(node(page, id), 'temp').getByRole('button', { name: /80/ }).first().click()
    await page.getByLabel('New value of temp').fill('hot')
    await page.getByLabel('New value of temp').press('Enter')
    await expect(page.getByRole('alert').filter({ hasText: 'Not saved' })).toContainText('must be a number')
  } finally {
    await page.request.delete(`/api/ngsi/entities/${encodeURIComponent(id)}`)
  }
})
