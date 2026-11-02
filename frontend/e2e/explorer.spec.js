import { test, expect } from '@playwright/test'
import { presetControls } from './helpers'

test.beforeEach(async ({ page }) => {
  await presetControls(page, { authEnabled: false })
})

const entities = (page) => page.getByRole('region', { name: 'Entities' })
const attribute = (page, name) => page.locator(`[data-attribute="${name}"]`)
const localInput = (ms) => new Date(ms - new Date(ms).getTimezoneOffset() * 60_000).toISOString().slice(0, 16)

test('query → entity → relationship → history', async ({ page }) => {
  await page.goto('/explorer')
  await page.getByLabel('Entity type').selectOption('Sensor')
  await page.getByRole('button', { name: 'Add condition' }).click()
  await page.getByLabel('Attribute of condition 1').selectOption('value')
  await page.getByLabel('Operator of condition 1').selectOption({ label: 'greater than' })
  await page.getByLabel('Value of condition 1').fill('40')
  await expect(page.getByLabel('Query expression')).toHaveText('value>40')
  await page.getByRole('button', { name: 'Apply query' }).click()
  await expect(page).toHaveURL(/\/explorer\?type=Sensor&q=value%3E40$/)

  await entities(page).getByRole('link', { name: /Process chiller 01 flow/ }).click()
  await expect(page.getByRole('heading', { level: 2, name: 'Process chiller 01 flow' })).toBeVisible()
  await expect(page).toHaveURL(/\/explorer\/urn%3Angsi-ld%3ASensor%3Achiller-01-flow\?type=Sensor/)

  await attribute(page, 'measures').getByRole('link', { name: 'urn:ngsi-ld:Machine:chiller-01' }).click()
  await expect(page.getByRole('heading', { level: 2, name: 'Process chiller 01' })).toBeVisible()
  await page.goBack()
  await expect(page.getByRole('heading', { level: 2, name: 'Process chiller 01 flow' })).toBeVisible()

  await page.getByRole('button', { name: 'History of value' }).click()
  const history = page.getByRole('region', { name: 'History of value' })
  await history.getByLabel('Time range').selectOption({ label: 'Last 6 hours' })
  await expect(history.getByRole('img', { name: /^Line chart of value in l\/min/ })).toBeVisible()
  await expect(history.locator('.recharts-line-curve')).toBeVisible()
  await expect(history.getByRole('table').getByRole('row')).toHaveCount(73)
})

test('edit with suggestions, then view the past and return to the present', async ({ page }) => {
  await page.goto('/explorer/urn%3Angsi-ld%3AMachine%3Apress-brake-01?type=Machine')
  await page.getByRole('button', { name: 'Edit status' }).click()
  await page.getByRole('group', { name: 'Suggested values' }).getByRole('button', { name: 'maintenance' }).click()
  await page.getByRole('button', { name: 'Save' }).click()
  await expect(attribute(page, 'status')).toContainText('maintenance')
  await page.reload()
  await expect(attribute(page, 'status')).toContainText('maintenance')

  await page.getByLabel('View as of').fill(localInput(Date.now() - 3 * 24 * 3600_000))
  await page.getByRole('button', { name: 'Show', exact: true }).click()
  const banner = page.getByRole('region', { name: 'Historical view' })
  await expect(banner).toContainText('Editing is disabled.')
  await expect(page).toHaveURL(/[?&]at=/)
  await expect(page.getByRole('heading', { level: 2, name: 'Press brake 01' })).toBeVisible()
  await expect(attribute(page, 'status')).not.toContainText('maintenance')
  await expect(page.getByRole('button', { name: 'Edit status' })).toHaveCount(0)
  await expect(page.getByLabel('Entity type').locator('option', { hasText: 'Camera' })).toHaveCount(1)

  await banner.getByRole('button', { name: 'Return to the present' }).click()
  await expect(banner).toHaveCount(0)
  await expect(attribute(page, 'status')).toContainText('maintenance')
  await expect(page.getByLabel('Entity type').locator('option', { hasText: 'Camera' })).toHaveCount(0)
})

test('import a sample file', async ({ page }) => {
  await page.goto('/explorer?type=ProductionLine')
  await expect(entities(page).getByRole('link')).toHaveCount(3)
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
  await expect(entities(page).getByRole('link')).toHaveCount(4)
  await expect(entities(page).getByRole('link', { name: /Line A · Laser cutting/ })).toBeVisible()
})

test('live values change on screen and the indicator reports unavailability', async ({ page }) => {
  await presetControls(page, { authEnabled: false, speed: 25 })
  await page.goto('/explorer/urn%3Angsi-ld%3ASensor%3Achiller-01-flow')
  await expect(page.getByText('Live updates working')).toBeVisible()
  await expect(attribute(page, 'value')).toHaveClass(/attr--changed/)
  await expect(attribute(page, 'value').getByText('Updated')).toBeVisible()
})
