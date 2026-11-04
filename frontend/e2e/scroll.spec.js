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
import { presetControls } from './helpers'

/** Selecting an item while scrolled down shows its detail without jumping to the top. */
test.beforeEach(async ({ page }) => {
  await presetControls(page, { authEnabled: false, newAlerts: false })
})

const inView = (locator) => locator.evaluate((el) => {
  const r = el.getBoundingClientRect()
  return r.top >= 0 && r.bottom <= window.innerHeight
})

for (const viewport of [{ width: 1400, height: 800 }, { width: 800, height: 800 }]) {
  test(`incident history at ${viewport.width} px: selecting while scrolled down shows the incident and the page does not return to the top`, async ({ page }) => {
    await page.setViewportSize(viewport)
    await page.goto('/history')
    const items = page.locator('.run-list__link')
    await items.nth(1).click()
    await expect(page.getByRole('heading', { level: 2, name: /^Incident #/ })).toBeVisible()
    await page.mouse.wheel(0, 900)
    const target = items.nth(6)
    await target.scrollIntoViewIfNeeded()
    const number = (await target.textContent()).match(/#(\d+)/)[1]
    await target.click()
    const heading = page.getByRole('heading', { level: 2, name: `Incident #${number}` })
    await expect(heading).toBeVisible()
    await expect.poll(() => inView(heading)).toBe(true)
    // Side by side, the list stays where it was; stacked, the incident below the list is shown.
    if (viewport.width >= 900) expect(await inView(target)).toBe(true)
  })
}

test('active incidents: the open runs list stays in view next to a long run', async ({ page }) => {
  await page.setViewportSize({ width: 1400, height: 700 })
  await page.goto('/incidents')
  const items = page.locator('.run-list__link')
  await items.nth(2).click()
  await expect(page.getByRole('heading', { level: 2, name: 'Incident #44' })).toBeVisible()
  await page.mouse.move(900, 400)
  await page.mouse.wheel(0, 900)
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(300)
  await expect.poll(() => inView(items.nth(3))).toBe(true)
  await items.nth(3).click()
  const heading = page.getByRole('heading', { level: 2, name: 'Incident #43' })
  await expect(heading).toBeVisible()
  await expect.poll(() => inView(heading)).toBe(true)
})

for (const viewport of [{ width: 1400, height: 800 }, { width: 800, height: 800 }]) {
  test(`alerts at ${viewport.width} px: opening an alert far down the list shows its detail without jumping to the top`, async ({ page }) => {
    await page.setViewportSize(viewport)
    await page.goto('/alerts')
    const row = page.locator('tbody tr').nth(12)
    await row.scrollIntoViewIfNeeded()
    const id = await row.getAttribute('data-alert')
    await row.locator('td').nth(5).click()
    const heading = page.getByRole('heading', { name: `Alert ${id}` })
    await expect(heading).toBeVisible()
    await expect.poll(() => inView(heading)).toBe(true)
    // Side by side, the selected row stays in view too.
    if (viewport.width >= 900) await expect.poll(() => inView(page.locator(`tr[data-alert="${id}"]`))).toBe(true)
    expect(await page.evaluate(() => window.scrollY)).toBeGreaterThan(0)
  })
}

test('dataspace: choosing a peer while scrolled down shows its capabilities and keeps the peer in view', async ({ page }) => {
  await page.setViewportSize({ width: 1400, height: 700 })
  await page.goto('/dataspace')
  const peers = page.getByRole('list', { name: 'Peers' }).getByRole('link')
  await peers.nth(0).click()
  await expect(page.getByRole('region', { name: /^Capabilities of / })).toBeVisible()
  const target = peers.nth(3)
  await target.scrollIntoViewIfNeeded()
  await page.mouse.move(700, 350)
  await page.mouse.wheel(0, 250)
  const name = (await target.locator('.peer-list__name').textContent()).trim()
  await target.click()
  const heading = page.getByRole('heading', { level: 3, name })
  await expect(heading).toBeVisible()
  await expect.poll(() => inView(heading)).toBe(true)
  await expect.poll(() => inView(target)).toBe(true)
  expect(await page.evaluate(() => window.scrollY)).toBeGreaterThan(0)
})
