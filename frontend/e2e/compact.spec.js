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
import { AREAS, presetControls } from './helpers'

test.beforeEach(async ({ page }) => {
  await presetControls(page, { authEnabled: false, newAlerts: false })
})

/** Computed size of the body text and the standard controls. */
const sizes = (page) => page.evaluate(() => {
  const px = (el, prop) => parseFloat(getComputedStyle(el)[prop])
  const input = document.querySelector('input:not([type=checkbox]):not([type=radio]):not([type=file])')
  const button = document.querySelector('.btn--md')
  return { body: px(document.body, 'fontSize'), input: input && px(input, 'height'), button: button && px(button, 'minHeight') }
})

test('compact scale: 14 px body text and 32 px controls in every area', async ({ page }) => {
  for (const [path, label] of AREAS) {
    await page.goto(path)
    await expect(page.getByRole('heading', { level: 1, name: label })).toBeVisible()
    const s = await sizes(page)
    expect(s.body, path).toBe(14)
    if (s.input) expect(s.input, path).toBe(32)
    if (s.button) expect(s.button, path).toBe(32)
  }
})

test('dense attribute rows are 13 px and meta information 12 px', async ({ page }) => {
  await page.goto('/explorer/urn%3Angsi-ld%3ASensor%3Achiller-01-flow?type=Sensor')
  const line = page.locator('[data-attribute="value"] .attr-line').first()
  await expect(line).toBeVisible()
  expect(await line.evaluate((el) => parseFloat(getComputedStyle(el).fontSize))).toBe(13)
  expect(await line.locator('.attr-line__time').evaluate((el) => parseFloat(getComputedStyle(el).fontSize))).toBe(12)
})

test('raising the browser font size grows text and controls, without cutting anything off', async ({ page }) => {
  await page.goto('/explorer?type=Machine')
  await expect(page.getByRole('region', { name: 'Entities' }).locator('article').first()).toBeVisible()
  await page.addStyleTag({ content: 'html { font-size: 20px; }' })
  const s = await sizes(page)
  expect(s.body).toBeCloseTo(17.5)
  expect(s.input).toBeCloseTo(40)
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
  expect(overflow).toBeLessThanOrEqual(0)
})

test.describe('at 1280 px', () => {
  test.use({ viewport: { width: 1280, height: 900 } })

  test('the first entity starts within 150 px of the top of the query bar', async ({ page }) => {
    await page.goto('/explorer?type=Machine&hasAttr=status&limit=20')
    const first = page.getByRole('region', { name: 'Entities' }).locator('article').first()
    await expect(first).toBeVisible()
    const bar = await page.locator('.query-bar').evaluate((el) => el.getBoundingClientRect().top)
    const top = await first.evaluate((el) => el.getBoundingClientRect().top)
    expect(top - bar).toBeLessThanOrEqual(150)
  })

  test('the row actions are icons, visible without hovering', async ({ page }) => {
    await page.goto('/explorer/urn%3Angsi-ld%3ASensor%3Achiller-01-flow?type=Sensor')
    await page.mouse.move(0, 0)
    const history = page.getByRole('button', { name: 'History of value' })
    await expect(history).toBeVisible()
    expect(await history.evaluate((el) => el.textContent.trim())).toBe('')
    expect(await history.evaluate((el) => getComputedStyle(el).opacity)).toBe('1')
  })
})
