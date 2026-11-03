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

test('buttons next to inputs and selects are level with them', async ({ page }) => {
  await presetControls(page, { authEnabled: false })
  await page.goto('/')
  await expect(page.getByRole('button', { name: 'Refresh now' })).toBeVisible()
  expect(await misalignedControls(page)).toEqual([])
})
