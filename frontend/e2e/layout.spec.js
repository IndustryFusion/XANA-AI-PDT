import { test, expect } from '@playwright/test'
import { AREAS, misalignedControls, presetControls } from './helpers'

test.use({ viewport: { width: 800, height: 900 } })

test('below 900 px every area fits without horizontal scrolling', async ({ page }) => {
  await presetControls(page, { authEnabled: false })
  for (const [path, label] of AREAS) {
    await page.goto(path)
    await expect(page.getByRole('heading', { level: 1, name: label })).toBeVisible()
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
    expect(overflow, `${path} overflows horizontally`).toBeLessThanOrEqual(0)
  }
})

test('run view, conversation and incident detail fit and stack below 900 px', async ({ page }) => {
  await presetControls(page, { authEnabled: false })
  for (const [path, heading] of [['/incidents/run-1002', 'Incident #42'], ['/incidents/run-1003', 'Incident #43'], ['/history/32', 'Incident #32']]) {
    await page.goto(path)
    await expect(page.getByRole('heading', { level: 2, name: heading })).toBeVisible()
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
    expect(overflow, `${path} overflows horizontally`).toBeLessThanOrEqual(0)
    const [list, main] = await Promise.all(['.split__side', '.split__main'].map((sel) => page.locator(sel).evaluate((el) => el.getBoundingClientRect())))
    expect(main.top).toBeGreaterThan(list.top)
    expect(Math.round(main.left)).toBe(Math.round(list.left))
  }
})

test('dashboard tiles are in one column below 900 px', async ({ page }) => {
  await presetControls(page, { authEnabled: false })
  await page.goto('/')
  const tiles = page.locator('.dashboard-grid > .card')
  await expect(tiles).toHaveCount(5)
  const lefts = await tiles.evaluateAll((els) => els.map((e) => Math.round(e.getBoundingClientRect().left)))
  expect(new Set(lefts).size).toBe(1)
})

test('entity view, history and alert detail fit and stack below 900 px', async ({ page }) => {
  await presetControls(page, { authEnabled: false, newAlerts: false })
  const overflow = () => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)

  await page.goto('/explorer/urn%3Angsi-ld%3ASensor%3Achiller-01-flow?type=Sensor')
  await page.getByRole('button', { name: '2 sub-attributes of value' }).click()
  await page.getByRole('button', { name: 'Expand urn:ngsi-ld:Machine:chiller-01 in place' }).click()
  await expect(page.locator('.attr-line__nested [data-entity="urn:ngsi-ld:Machine:chiller-01"] [data-attribute="status"]')).toBeVisible()
  await page.getByRole('button', { name: 'History of value' }).click()
  await expect(page.getByRole('region', { name: 'History of value' }).getByRole('table')).toBeVisible()
  expect(await overflow(), 'entity view overflows horizontally').toBeLessThanOrEqual(0)
  const [query, list] = await Promise.all(['.query-bar', '.entity-list'].map((sel) => page.locator(sel).first().evaluate((el) => el.getBoundingClientRect())))
  expect(list.top).toBeGreaterThan(query.top)
  expect(Math.round(list.left)).toBe(Math.round(query.left))

  await page.goto('/alerts/alert-001')
  await expect(page.getByRole('article', { name: 'Alert alert-001' })).toBeVisible()
  expect(await overflow(), 'alerts overflow horizontally').toBeLessThanOrEqual(0)
  const [table, detail] = await Promise.all(['.alert-list', '.alert-detail'].map((sel) => page.locator(sel).evaluate((el) => el.getBoundingClientRect())))
  expect(detail.top).toBeGreaterThan(table.top)
})

test('buttons next to inputs and selects are level with them', async ({ page }) => {
  await presetControls(page, { authEnabled: false })
  await page.goto('/')
  await expect(page.getByRole('button', { name: 'Refresh now' })).toBeVisible()
  expect(await misalignedControls(page)).toEqual([])
})

for (const [name, path, open] of [
  ['explorer toolbar and query conditions', '/explorer?type=Machine', async (page) => page.getByRole('button', { name: 'Add condition' }).click()],
  ['explorer value editor', '/explorer/urn%3Angsi-ld%3AMachine%3Apress-brake-01?type=Machine', async (page) => page.getByRole('button', { name: /^Edit status/ }).first().click()],
  ['import from a URL', '/explorer', async (page) => {
    await page.getByRole('button', { name: 'Import…' }).click()
    await page.getByRole('dialog').getByLabel('URL', { exact: true }).check()
    await expect(page.getByRole('button', { name: 'Fetch' })).toBeVisible()
  }],
  ['alert filters', '/alerts', async (page) => expect(page.locator('tbody tr').first()).toBeVisible()],
]) {
  test(`${name}: buttons are level with the inputs next to them`, async ({ page }) => {
    await presetControls(page, { authEnabled: false, newAlerts: false })
    await page.goto(path)
    await open(page)
    await expect(page.getByText(/^Loading/)).toHaveCount(0)
    expect(await misalignedControls(page)).toEqual([])
  })
}
