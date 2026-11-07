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

import { test, expect } from '@playwright/test'
import { presetControls, setControls } from './helpers'
import { machineStatusAt, STATUS_STEP_MS } from '../src/data/sources/mock/history.js'

// The mock's values follow the clock: a fixed moment keeps these tests the same at any time of day.
const NOW = Date.parse('2026-11-04T10:02:03Z')

test.beforeEach(async ({ page }) => {
  await page.clock.setFixedTime(NOW)
  await presetControls(page, { authEnabled: false })
})

const entities = (page) => page.getByRole('region', { name: 'Entities' })
const nodeHeadings = (page) => entities(page).getByRole('heading', { level: 3 })
const node = (page, id) => page.locator(`[data-entity="${id}"]`).first()
const attribute = (scope, name) => scope.locator(`[data-attribute="${name}"]`).first()
const localInput = (ms) => new Date(ms - new Date(ms).getTimezoneOffset() * 60_000).toISOString().slice(0, 16)
const momentWithStatusOtherThan = (id, status) => {
  const start = (Math.floor((NOW - 3 * 24 * 3600_000) / STATUS_STEP_MS) + 0.5) * STATUS_STEP_MS
  for (let t = start; ; t -= STATUS_STEP_MS) if (machineStatusAt(id, t) !== status) return t
}
const SENSOR = 'urn:ngsi-ld:Sensor:chiller-01-flow'
const CHILLER = 'urn:ngsi-ld:Machine:chiller-01'
const MACHINE = 'urn:ngsi-ld:Machine:press-brake-01'

test('query → expand an entity → relationship in place and followed → history', async ({ page }) => {
  await page.goto('/explorer')
  await page.getByLabel('Entity type').selectOption('Sensor')
  await page.getByRole('button', { name: 'Add condition' }).click()
  await page.getByLabel('Attribute of condition 1').selectOption('value')
  await page.getByLabel('Operator of condition 1').selectOption({ label: 'greater than' })
  await page.getByLabel('Value of condition 1').fill('40')
  await expect(page.getByLabel('Query expression')).toHaveText('value>40')
  await page.getByRole('button', { name: 'Apply query' }).click()
  await expect(page).toHaveURL(/\/explorer\?type=Sensor&q=value%3E40$/)

  const toggle = entities(page).getByRole('button', { name: 'Process chiller 01 flow', exact: true })
  await toggle.click()
  await expect(toggle).toHaveAttribute('aria-expanded', 'true')
  await expect(page).toHaveURL(/\/explorer\/urn%3Angsi-ld%3ASensor%3Achiller-01-flow\?type=Sensor&q=value%3E40$/)
  const sensor = node(page, SENSOR)
  const measures = attribute(sensor, 'measures')

  await measures.getByRole('button', { name: `Expand ${CHILLER} in place` }).click()
  const nested = measures.locator(`[data-entity="${CHILLER}"]`)
  await expect(nested.getByRole('heading', { level: 4, name: 'Process chiller 01' })).toBeVisible()
  await expect(attribute(nested, 'partOf')).toContainText('urn:ngsi-ld:ProductionLine:line-a')
  const indent = await nested.evaluate((el) => el.getBoundingClientRect().left)
  const line = await measures.locator('.attr-line').first().evaluate((el) => el.getBoundingClientRect().left)
  expect(indent).toBeGreaterThan(line)

  await measures.locator('.attr-line').first().getByRole('link', { name: CHILLER }).click()
  await expect(page).toHaveURL(/\/explorer\/urn%3Angsi-ld%3AMachine%3Achiller-01\?type=Sensor/)
  await expect(entities(page).getByRole('button', { name: 'Process chiller 01', exact: true })).toHaveAttribute('aria-expanded', 'true')
  await page.goBack()
  await expect(page).toHaveURL(/\/explorer\/urn%3Angsi-ld%3ASensor%3Achiller-01-flow\?/)

  await sensor.getByRole('button', { name: 'History of value' }).click()
  const history = page.getByRole('region', { name: 'History of value' })
  await history.getByLabel('Time range').selectOption({ label: 'Last 6 hours' })
  await expect(history.getByRole('img', { name: /^Line chart of value in l\/min/ })).toBeVisible()
  await expect(history.locator('.recharts-line-curve')).toBeVisible()
  await expect(history.getByRole('table').getByRole('row')).toHaveCount(73)
})

test('opening an entity URL expands its node and scrolls it into view', async ({ page }) => {
  await page.goto('/explorer/urn%3Angsi-ld%3ASensor%3Aextractor-01-differential-pressure?type=Sensor')
  const toggle = entities(page).getByRole('button', { name: 'Fume extractor 01 differential pressure', exact: true })
  await expect(toggle).toHaveAttribute('aria-expanded', 'true')
  await expect(nodeHeadings(page)).toHaveCount(13)
  await expect(toggle).toBeInViewport()
})

test('edit in place with suggestions, cancel with Escape, then view the past and return to the present', async ({ page }) => {
  await page.goto('/explorer/urn%3Angsi-ld%3AMachine%3Apress-brake-01?type=Machine')
  const status = attribute(node(page, MACHINE), 'status')
  await status.getByRole('button', { name: /^Value of status:/ }).click()
  // `fault` is never a machine's status from the history, so it is always among the suggestions.
  await status.getByRole('listbox', { name: 'Suggested values' }).getByRole('option', { name: 'fault' }).click()
  await expect(status.getByRole('combobox', { name: 'New value of status' })).toHaveValue('fault')
  await page.keyboard.press('Enter')
  await expect(status).toContainText('"fault"')
  await expect(status.getByRole('combobox')).toHaveCount(0)

  await status.getByRole('button', { name: 'Edit status' }).click()
  await status.getByRole('combobox').fill('setup')
  await page.keyboard.press('Escape')
  await expect(status.getByRole('combobox')).toHaveCount(0)
  await expect(status).toContainText('"fault"')
  await page.reload()
  await expect(attribute(node(page, MACHINE), 'status')).toContainText('"fault"')

  // A moment in the past, mid-way through a recorded period, when the machine had another status.
  const past = momentWithStatusOtherThan(MACHINE, 'fault')
  await page.getByLabel('View as of').fill(localInput(past))
  await page.getByRole('button', { name: 'Show', exact: true }).click()
  const banner = page.getByRole('region', { name: 'Historical view' })
  await expect(banner).toContainText('Editing is disabled.')
  await expect(page).toHaveURL(/[?&]at=/)
  await expect(entities(page).getByRole('button', { name: 'Press brake 01', exact: true })).toHaveAttribute('aria-expanded', 'true')
  await expect(attribute(node(page, MACHINE), 'status')).toContainText(`"${machineStatusAt(MACHINE, past)}"`)
  await expect(attribute(node(page, MACHINE), 'status')).not.toContainText('fault')
  await expect(page.getByRole('button', { name: 'Edit status' })).toHaveCount(0)
  await expect(page.getByLabel('Entity type').locator('option', { hasText: 'Camera' })).toHaveCount(1)

  await banner.getByRole('button', { name: 'Return to the present' }).click()
  await expect(banner).toHaveCount(0)
  await expect(attribute(node(page, MACHINE), 'status')).toContainText('fault')
  await expect(page.getByLabel('Entity type').locator('option', { hasText: 'Camera' })).toHaveCount(0)
})

test('edit the raw JSON of an entity', async ({ page }) => {
  await page.goto('/explorer/urn%3Angsi-ld%3AMachine%3Apress-brake-01')
  const machine = node(page, MACHINE)
  await machine.getByRole('button', { name: 'Raw JSON of Press brake 01' }).click()
  const raw = machine.getByLabel('Entity JSON')
  const entity = JSON.parse(await raw.inputValue())
  await expect(machine.getByRole('button', { name: 'Save JSON' })).toBeDisabled()
  await raw.fill('{ not json')
  await machine.getByRole('button', { name: 'Save JSON' }).click()
  await expect(machine.getByRole('alert')).toContainText('The JSON is not valid')

  delete entity.manufacturer
  entity.machineType.value = 'PanelBender'
  entity.floorArea = { type: 'Property', value: 12, unitCode: 'MTK' }
  await raw.fill(JSON.stringify(entity, null, 2))
  await machine.getByRole('button', { name: 'Save JSON' }).click()
  await expect(page.getByText('Entity JSON saved.')).toBeVisible()
  await machine.getByRole('button', { name: 'Raw JSON of Press brake 01' }).click()
  await expect(attribute(machine, 'floorArea')).toContainText('12 MTK')
  await expect(attribute(machine, 'machineType')).toContainText('"PanelBender"')
  await expect(attribute(machine, 'manufacturer')).toHaveCount(0)
})

test('import a sample file', async ({ page }) => {
  await page.goto('/explorer?type=ProductionLine')
  await expect(nodeHeadings(page)).toHaveCount(3)
  await page.getByRole('button', { name: 'Import…' }).click()
  const dialog = page.getByRole('dialog', { name: 'Import entities' })
  const doc = [
    { id: 'urn:ngsi-ld:ProductionLine:line-e', type: 'ProductionLine', name: { type: 'Property', value: 'Line E · Assembly' } },
    { id: 'urn:ngsi-ld:ProductionLine:line-a', type: 'ProductionLine', name: { type: 'Property', value: 'Line A · Laser cutting' } },
  ]
  await dialog.getByLabel('File with NGSI-LD entities (JSON)').setInputFiles({ name: 'lines.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(doc)) })
  await expect(dialog.getByRole('region', { name: 'Preview' })).toContainText('2 entities are ready to import.')
  await dialog.getByRole('button', { name: 'Import 2 entities' }).click()
  await expect(dialog.getByRole('region', { name: 'Import results' })).toContainText('Import finished: 1 created, 1 updated, 0 failed.')
  await dialog.getByRole('button', { name: 'Done' }).click()
  await expect(nodeHeadings(page)).toHaveCount(4)
  await expect(entities(page).getByRole('button', { name: 'Line A · Laser cutting', exact: true })).toBeVisible()
})

test('live values change on screen and are highlighted', async ({ page }) => {
  await page.goto('/explorer')
  await setControls(page, { speed: 25 })
  await page.goto('/explorer/urn%3Angsi-ld%3ASensor%3Achiller-01-flow')
  await expect(page.getByText('Live updates working')).toBeVisible()
  const value = attribute(node(page, SENSOR), 'value')
  await expect(value.locator('.attr-line').first()).toHaveClass(/attr-line--changed/)
  await expect(value.getByText('Updated')).toBeVisible()
})
