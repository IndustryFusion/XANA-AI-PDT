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
/** The page's scroll position once it has stopped changing. */
async function stableScrollY(page) {
  let previous = null
  let y = null
  await expect.poll(async () => {
    y = await page.evaluate(() => window.scrollY)
    const same = y === previous
    previous = y
    return same
  }, { intervals: [100, 150, 250] }).toBe(true)
  return y
}
/** Opens the first alert's resource in the data explorer; returns the resource. */
async function openFirstAlertsResource(page) {
  await page.locator('tbody tr').first().locator('td').nth(5).click()
  const open = page.getByRole('link', { name: /^Open .* in the data explorer$/ })
  const resource = (await open.textContent()).replace(/^Open (.*) in the data explorer$/, '$1')
  await open.click()
  return resource
}
const SENSOR = 'urn:ngsi-ld:Sensor:chiller-01-flow'
const CHILLER = 'urn:ngsi-ld:Machine:chiller-01'
const MACHINE = 'urn:ngsi-ld:Machine:press-brake-01'

test('query → expand an entity → relationship in place and followed → history', async ({ page }) => {
  await page.goto('/explorer')
  await page.getByLabel('Entity type').fill('Sensor')
  await page.getByRole('button', { name: 'More filters' }).click()
  await page.getByRole('button', { name: 'Add condition' }).click()
  await page.getByLabel('Attribute of condition 1').selectOption('value')
  await page.getByLabel('Operator of condition 1').selectOption({ label: 'greater than' })
  await page.getByLabel('Value of condition 1').fill('40')
  await expect(page.getByLabel('Query expression')).toHaveText('value>40')
  await page.getByRole('button', { name: 'Search' }).click()
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
  await expect(status.getByRole('combobox', { name: 'New value of status' })).toHaveCount(0)

  await status.getByRole('button', { name: 'Edit status' }).click()
  await status.getByRole('combobox', { name: 'New value of status' }).fill('setup')
  await page.keyboard.press('Escape')
  await expect(status.getByRole('combobox', { name: 'New value of status' })).toHaveCount(0)
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
  await expect(page.locator('datalist option[value="Camera"]')).toHaveCount(1)

  await banner.getByRole('button', { name: 'Return to the present' }).click()
  await expect(banner).toHaveCount(0)
  await expect(attribute(node(page, MACHINE), 'status')).toContainText('fault')
  await expect(page.locator('datalist option[value="Camera"]')).toHaveCount(0)
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

test('delete by type: "Select all types" selects every type, is mixed when some are, and deletes them all', async ({ page }) => {
  await page.goto('/explorer?type=Sensor')
  await expect(nodeHeadings(page)).toHaveCount(13)
  await page.getByRole('button', { name: 'Delete by type…' }).click()
  const dialog = page.getByRole('dialog', { name: 'Delete entities by type' })
  const all = dialog.getByRole('checkbox', { name: 'Select all types' })
  await all.check()
  const count = await dialog.getByRole('checkbox').count()
  for (let i = 0; i < count; i++) await expect(dialog.getByRole('checkbox').nth(i)).toBeChecked()
  await dialog.getByRole('checkbox', { name: 'Sensor', exact: true }).uncheck()
  await expect(all).not.toBeChecked()
  expect(await all.evaluate((el) => el.indeterminate)).toBe(true)
  await all.check()
  await dialog.getByRole('button', { name: 'Delete entities…' }).click()
  await dialog.getByRole('button', { name: 'Delete all' }).click()
  const done = dialog.getByRole('region', { name: 'Deleted entities' })
  await expect(done.getByRole('listitem')).toHaveCount(count - 1)
  await expect(done).toContainText('Sensor: 13 entities deleted')
  await dialog.getByRole('button', { name: 'Done' }).click()
  await expect(entities(page)).toContainText('No entities matched the query.')
})

test('each instance of a multi-relationship expands its own target in place, and only under itself', async ({ page }) => {
  const LINE = 'urn:ngsi-ld:ProductionLine:line-multi'
  await page.goto('/explorer?type=ProductionLine')
  await expect(nodeHeadings(page)).toHaveCount(3)
  await page.getByRole('button', { name: 'Import…' }).click()
  const dialog = page.getByRole('dialog', { name: 'Import entities' })
  const doc = [{
    id: LINE, type: 'ProductionLine', name: { type: 'Property', value: 'Line M · Two machines' },
    hasMachine: [
      { type: 'Relationship', object: MACHINE, datasetId: 'urn:ngsi-ld:Dataset:first' },
      { type: 'Relationship', object: CHILLER, datasetId: 'urn:ngsi-ld:Dataset:second' },
    ],
  }]
  await dialog.getByLabel('File with NGSI-LD entities (JSON)').setInputFiles({ name: 'line.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(doc)) })
  await dialog.getByRole('button', { name: 'Import 1 entities' }).click()
  await expect(dialog.getByRole('region', { name: 'Import results' })).toContainText('Import finished: 1 created')
  await dialog.getByRole('button', { name: 'Done' }).click()
  await expect(nodeHeadings(page)).toHaveCount(4)
  await entities(page).getByRole('button', { name: 'Line M · Two machines', exact: true }).click()
  const line = node(page, LINE)
  const relation = attribute(line, 'hasMachine')
  const nested = () => relation.locator('.attr-line__nested > div > [data-entity]').evaluateAll((els) => els.map((el) => el.dataset.entity))
  await relation.getByRole('button', { name: /^Expand .*press-brake-01 in place$/ }).click()
  await expect.poll(nested).toEqual([MACHINE])
  await expect(relation.getByRole('button', { name: /^Expand .*chiller-01 in place$/ })).toHaveAttribute('aria-expanded', 'false')
  await relation.getByRole('button', { name: /^Expand .*chiller-01 in place$/ }).click()
  await expect.poll(nested).toEqual([MACHINE, CHILLER])
  await relation.getByRole('button', { name: /^Expand .*press-brake-01 in place$/ }).click()
  await expect.poll(nested).toEqual([CHILLER])
})

test('an entity opened from an alert is marked as selected and brought into view over the kept scroll position', async ({ page }) => {
  await page.goto('/explorer?type=Sensor')
  await expect(nodeHeadings(page)).toHaveCount(13)
  await page.mouse.move(700, 400)
  await page.mouse.wheel(0, 3000)
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(300)
  await page.getByRole('link', { name: 'Alerts', exact: true }).click()
  await page.locator('tbody tr').first().locator('td').nth(5).click()
  const open = page.getByRole('link', { name: /^Open .* in the data explorer$/ })
  const resource = (await open.textContent()).replace(/^Open (.*) in the data explorer$/, '$1')
  await open.click()
  const target = page.locator(`.entity-node--current[data-entity="${resource}"]`)
  await expect(target).toHaveCount(1)
  await expect(page.locator('.entity-node--current')).toHaveCount(1)
  await expect(target.getByText('Selected', { exact: true })).toBeVisible()
  await expect(target.locator('.entity-node__header')).toBeInViewport()
})

test('back at the address it was kept for, the explorer restores the scroll position, also with an entity open', async ({ page }) => {
  await page.goto('/explorer/urn%3Angsi-ld%3ASensor%3Aextractor-01-differential-pressure?type=Sensor')
  await expect(nodeHeadings(page)).toHaveCount(13)
  await stableScrollY(page)
  await page.mouse.move(700, 400)
  await page.mouse.wheel(0, -400)
  const kept = await stableScrollY(page)
  expect(kept).toBeGreaterThan(0)
  await page.getByRole('link', { name: 'Alerts', exact: true }).click()
  await expect(page.locator('tbody tr').first()).toBeVisible()
  await page.getByRole('link', { name: 'Data explorer', exact: true }).click()
  await expect(nodeHeadings(page)).toHaveCount(13)
  await expect.poll(async () => Math.abs(await page.evaluate(() => window.scrollY) - kept)).toBeLessThan(5)
  expect(Math.abs(await stableScrollY(page) - kept)).toBeLessThan(5)
})

test('an entity expanded at the end of the list is kept with the scroll position for the return', async ({ page }) => {
  await page.goto('/explorer?type=Sensor')
  await expect(nodeHeadings(page)).toHaveCount(13)
  await page.mouse.move(700, 400)
  await page.mouse.wheel(0, 5000)
  await stableScrollY(page)
  await entities(page).locator('.entity-node__toggle').last().click()
  await expect(page.locator('.entity-node--current')).toHaveCount(1)
  await page.mouse.wheel(0, -200)
  const kept = await stableScrollY(page)
  await page.getByRole('link', { name: 'Alerts', exact: true }).click()
  await expect(page.locator('tbody tr').first()).toBeVisible()
  await page.getByRole('link', { name: 'Data explorer', exact: true }).click()
  await expect(page.locator('.entity-node--current')).toHaveCount(1)
  await expect.poll(async () => Math.abs(await page.evaluate(() => window.scrollY) - kept)).toBeLessThan(5)
  expect(Math.abs(await stableScrollY(page) - kept)).toBeLessThan(5)
})

test('opening the same entity from an alert again brings it into view, not the kept position', async ({ page }) => {
  await page.setViewportSize({ width: 1400, height: 450 })
  await page.goto('/alerts')
  const resource = await openFirstAlertsResource(page)
  const target = page.locator(`.entity-node--current[data-entity="${resource}"]`)
  await expect(target.locator('[data-attribute]').first()).toBeVisible()
  await stableScrollY(page)
  await page.mouse.move(700, 300)
  await page.mouse.wheel(0, 600)
  expect(await stableScrollY(page)).toBeGreaterThan(0)
  await page.getByRole('link', { name: 'Alerts', exact: true }).click()
  expect(await openFirstAlertsResource(page)).toBe(resource)
  // Not the kept position, 600 px down: the entity's header is in view, below the sticky header.
  await expect(target.locator('.entity-node__header')).toBeInViewport()
  const [h, t] = await Promise.all([page.locator('.app-header').evaluate((el) => el.getBoundingClientRect().bottom), target.evaluate((el) => el.getBoundingClientRect().top)])
  expect(t).toBeGreaterThanOrEqual(h)
})

test('the mark moves to an entity expanded in the list', async ({ page }) => {
  await page.goto('/explorer?type=Machine')
  await expect(nodeHeadings(page)).not.toHaveCount(0)
  const toggles = entities(page).locator('.entity-node__toggle')
  await toggles.nth(0).click()
  const first = await entities(page).locator('.entity-node').nth(0).getAttribute('data-entity')
  await expect(page.locator(`.entity-node--current[data-entity="${first}"]`)).toHaveCount(1)
  await toggles.nth(1).click()
  const second = await entities(page).locator('.entity-node').nth(1).getAttribute('data-entity')
  await expect(page.locator(`.entity-node--current[data-entity="${second}"]`)).toHaveCount(1)
  await expect(page.locator('.entity-node--current')).toHaveCount(1)
  await expect(page.getByText('Selected', { exact: true })).toHaveCount(1)
})

test('the pulse marks an arrival, not an entity expanded in the list nor a return', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'no-preference' })
  const animation = () => page.locator('.entity-node--current').evaluate((el) => getComputedStyle(el).animationName)
  await page.goto('/explorer/urn%3Angsi-ld%3AMachine%3Apress-brake-01?type=Machine')
  await expect(page.locator('.entity-node--current')).toHaveCount(1)
  expect(await animation()).toBe('entity-node-arrive')
  await entities(page).locator('.entity-node:not(.entity-node--current) .entity-node__toggle').first().click()
  await expect(page.locator('.entity-node--current')).toHaveCount(1)
  expect(await animation()).toBe('none')
  await page.getByRole('link', { name: 'Alerts', exact: true }).click()
  await page.getByRole('link', { name: 'Data explorer', exact: true }).click()
  await expect(page.locator('.entity-node--current')).toHaveCount(1)
  expect(await animation()).toBe('none')
})

test('collapsing and expanding the arrived entity again does not pulse again', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'no-preference' })
  const animation = () => page.locator('.entity-node--current').evaluate((el) => getComputedStyle(el).animationName)
  await page.goto('/explorer/urn%3Angsi-ld%3AMachine%3Apress-brake-01?type=Machine')
  await expect(page.locator('.entity-node--current')).toHaveCount(1)
  expect(await animation()).toBe('entity-node-arrive')
  const toggle = entities(page).getByRole('button', { name: 'Press brake 01', exact: true })
  await toggle.click()
  await expect(page.locator('.entity-node--current')).toHaveCount(0)
  await toggle.click()
  await expect(page.locator('.entity-node--current')).toHaveCount(1)
  expect(await animation()).toBe('none')
})

test('a return to an address that names an attribute keeps the position the operator left', async ({ page }) => {
  await page.goto(`/explorer/urn%3Angsi-ld%3ASensor%3Aextractor-01-differential-pressure?type=Sensor&focus=${encodeURIComponent('["value"]')}`)
  await expect(page.locator('.attr-line--focused')).toHaveCount(1)
  await stableScrollY(page)
  await page.mouse.move(700, 400)
  await page.mouse.wheel(0, -300)
  const kept = await stableScrollY(page)
  await page.getByRole('link', { name: 'Alerts', exact: true }).click()
  await expect(page.locator('tbody tr').first()).toBeVisible()
  await page.getByRole('link', { name: 'Data explorer', exact: true }).click()
  await expect(page.locator('.attr-line--focused')).toHaveCount(1)
  await expect.poll(async () => Math.abs(await page.evaluate(() => window.scrollY) - kept)).toBeLessThan(5)
  expect(Math.abs(await stableScrollY(page) - kept)).toBeLessThan(5)
})

test('the arrival pulse runs only when the system does not ask for reduced motion', async ({ page }) => {
  const opened = '/explorer/urn%3Angsi-ld%3AMachine%3Apress-brake-01?type=Machine'
  const animation = () => page.locator('.entity-node--current').evaluate((el) => getComputedStyle(el).animationName)
  // The suite runs with reduced motion; this test asks for none first.
  await page.emulateMedia({ reducedMotion: 'no-preference' })
  await page.goto(opened)
  await expect(page.locator('.entity-node--current')).toHaveCount(1)
  expect(await animation()).toBe('entity-node-arrive')
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.goto(opened)
  await expect(page.locator('.entity-node--current')).toHaveCount(1)
  expect(await animation()).toBe('none')
  await expect(page.locator('.entity-node--current').getByText('Selected', { exact: true })).toBeVisible()
})

test('an entity opened in the middle of a long list comes to the top below the sticky header, not under it', async ({ page }) => {
  await page.goto('/explorer?type=Sensor')
  await expect(nodeHeadings(page)).toHaveCount(13)
  const id = await entities(page).locator('.entity-node').nth(5).getAttribute('data-entity')
  await page.goto(`/explorer/${encodeURIComponent(id)}?type=Sensor`)
  const header = page.locator('.app-header')
  const target = page.locator(`.entity-node--current[data-entity="${id}"]`)
  await expect(target).toHaveCount(1)
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(0)
  await expect.poll(async () => {
    const [h, t] = await Promise.all([header.evaluate((el) => el.getBoundingClientRect().bottom), target.evaluate((el) => el.getBoundingClientRect().top)])
    return t - h
  }).toBeGreaterThanOrEqual(0)
  await expect(target.getByText('Selected', { exact: true })).toBeInViewport()
})

test('expand all relationships of an entity shows its tree in place, and collapse all folds it', async ({ page }) => {
  await page.goto(`/explorer/${encodeURIComponent(SENSOR)}?type=Sensor`)
  const sensor = page.locator(`.entity-node--current[data-entity="${SENSOR}"]`)
  await expect(sensor.locator('[data-attribute="measures"]')).toBeVisible()
  await sensor.getByRole('button', { name: 'Expand all relationships of Process chiller 01 flow' }).click()
  await expect(sensor.locator(`.attr-line__nested [data-entity="${CHILLER}"]`)).toBeVisible()
  await expect(sensor.locator('.attr-line__nested [data-entity="urn:ngsi-ld:ProductionLine:line-a"]').first()).toBeVisible()
  await sensor.getByRole('button', { name: 'Collapse all in Process chiller 01 flow' }).first().click()
  await expect(sensor.locator('.attr-line__nested [data-entity]')).toHaveCount(0)
})
