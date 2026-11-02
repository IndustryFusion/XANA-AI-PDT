import { test, expect } from '@playwright/test'
import { AREAS, presetControls } from './helpers'

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

test('dashboard tiles are in one column below 900 px', async ({ page }) => {
  await presetControls(page, { authEnabled: false })
  await page.goto('/')
  const tiles = page.locator('.dashboard-grid > .card')
  await expect(tiles).toHaveCount(5)
  const lefts = await tiles.evaluateAll((els) => els.map((e) => Math.round(e.getBoundingClientRect().left)))
  expect(new Set(lefts).size).toBe(1)
})
