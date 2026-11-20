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

test.beforeEach(async ({ page }) => {
  await presetControls(page, { authEnabled: false, newAlerts: false })
})

const list = (page) => page.getByRole('region', { name: 'Alert list' })

test('alert filter → bulk acknowledge → detail → start incident', async ({ page }) => {
  await page.goto('/alerts')
  await page.getByLabel('Service').selectOption('Line A')
  await page.getByLabel('Search').fill('chiller')
  await expect(page).toHaveURL(/service=Line\+A&text=chiller/)
  const rows = list(page).locator('tbody tr')
  await expect(rows.first()).toBeVisible()
  // Wait until the list shows the filtered result.
  await expect(list(page).locator('tbody tr', { hasNotText: /chiller/i })).toHaveCount(0)
  const open = rows.filter({ has: page.locator('[data-status="open"]').nth(0) })
  const count = await open.count()
  expect(count).toBeGreaterThan(1)
  const ids = []
  for (let i = 0; i < 2; i++) {
    const row = open.nth(i)
    ids.push(await row.getAttribute('data-alert'))
    await row.getByRole('checkbox').check()
  }
  await page.getByRole('region', { name: 'Selected alerts' }).getByRole('button', { name: 'Acknowledge…', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: 'Acknowledge 2 alerts' })
  await dialog.getByLabel('Note (optional)').fill('Checking the coolant circuit.')
  await dialog.getByRole('button', { name: 'Acknowledge', exact: true }).click()
  await expect(page.getByRole('region', { name: 'Acknowledge: 2 succeeded, 0 failed' })).toBeVisible()
  for (const id of ids) await expect(list(page).locator(`tr[data-alert="${id}"] [data-status="ack"]`)).toBeVisible()

  await list(page).locator(`tr[data-alert="${ids[0]}"]`).getByRole('link', { name: new RegExp(`\\(${ids[0]}\\)$`) }).click()
  await expect(page).toHaveURL(new RegExp(`/alerts/${ids[0]}\\?service=Line\\+A&text=chiller$`))
  const detail = page.getByRole('article', { name: `Alert ${ids[0]}` })
  const history = detail.getByRole('region', { name: 'History' }).getByRole('listitem')
  await expect(history.last()).toContainText('Checking the coolant circuit.')
  const text = (await detail.locator('.alert-detail__text').textContent()).trim()

  await detail.getByRole('link', { name: 'Start new incident' }).click()
  await expect(page.getByRole('heading', { level: 1, name: 'Active incidents' })).toBeVisible()
  await expect(page.getByLabel('Machine ID')).toHaveValue(/^urn:ngsi-ld:Machine:/)
  await expect(page.getByLabel('Issue')).toHaveValue(text)
})

test('severity summary filters the list, and the filter survives a reload', async ({ page }) => {
  await page.goto('/alerts')
  const summary = page.getByRole('group', { name: 'Alerts by severity' })
  await summary.getByRole('button', { name: /Major/ }).click()
  await expect(summary.getByRole('button', { name: /Major/ })).toHaveAttribute('aria-pressed', 'true')
  await expect(page).toHaveURL(/\/alerts\?severity=major$/)
  await page.reload()
  await expect(list(page).locator('tbody tr [data-status]').first()).toBeVisible()
  const severities = await list(page).locator('tbody tr td:nth-child(2) [data-status]').evaluateAll((els) => els.map((e) => e.dataset.status))
  expect(new Set(severities)).toEqual(new Set(['major']))
})

test('new alerts appear on automatic refresh', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('xana.alerts.refreshMs', '10000'))
  await page.goto('/alerts')
  await expect(list(page).locator('tbody tr').first()).toBeVisible()
  await expect(list(page).locator('tr[data-alert="alert-017"]')).toHaveCount(0)
  await setControls(page, { newAlerts: true, speed: 25 })
  await page.getByRole('button', { name: 'Refresh now' }).click()
  await expect(list(page).locator('tr[data-alert="alert-017"]')).toBeVisible({ timeout: 20_000 })
})

test('right click on an alert row → start new incident, prefilled', async ({ page }) => {
  await page.goto('/alerts')
  const row = list(page).locator('tbody tr').first()
  const text = (await row.locator('td').nth(5).textContent()).trim()
  await row.locator('td').nth(5).click({ button: 'right' })
  const menu = page.getByRole('menu')
  await expect(menu.getByRole('menuitem').first()).toHaveText('Start new incident')
  await expect(menu.getByRole('menuitem').first()).toBeFocused()
  await page.keyboard.press('Enter')
  await expect(page.getByRole('heading', { level: 1, name: 'Active incidents' })).toBeVisible()
  await expect(page.getByLabel('Machine ID')).toHaveValue(/^urn:ngsi-ld:Machine:/)
  await expect(page.getByLabel('Issue')).toHaveValue(text)
})

test('selecting one alert offers start new incident directly; Shift+F10 on the row opens its menu', async ({ page }) => {
  await page.goto('/alerts')
  const row = list(page).locator('tbody tr').first()
  await row.getByRole('checkbox').check()
  const bar = page.getByRole('region', { name: 'Selected alerts' })
  await expect(bar.getByRole('link', { name: 'Start new incident' })).toBeVisible()
  await expect(row.getByRole('button')).toHaveCount(0)
  const link = row.getByRole('link').first()
  await link.focus()
  await page.keyboard.press('Shift+F10')
  await expect(page.getByRole('menu')).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(page.getByRole('menu')).toHaveCount(0)
  await expect(link).toBeFocused()
})

for (const width of [1280, 1024, 390]) {
  test(`at ${width} px the alert list fits without scrolling sideways, one line per alert`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 })
    const overflow = () => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
    const oneLine = () => list(page).locator('tbody tr').evaluateAll((rows) => {
      const heights = rows.map((r) => Math.round(r.getBoundingClientRect().height))
      return Math.max(...heights) - Math.min(...heights)
    })
    for (const path of ['/alerts', '/alerts/alert-001']) {
      await page.goto(path)
      await expect(list(page).locator('tbody tr').first()).toBeVisible()
      if (path !== '/alerts') await expect(page.getByRole('article', { name: 'Alert alert-001' })).toBeVisible()
      expect(await overflow(), `${path} overflows horizontally at ${width} px`).toBeLessThanOrEqual(0)
      expect(await oneLine(), `rows of ${path} differ in height at ${width} px`).toBeLessThanOrEqual(1)
      // Cells too long for their column end with an ellipsis and carry their full text.
      const cut = await list(page).locator('td.alert-table__clip').evaluateAll((cells) => cells
        .filter((c) => c.clientWidth > 0 && c.scrollWidth > c.clientWidth)
        .map((c) => getComputedStyle(c).textOverflow === 'ellipsis' && c.title.length > 0))
      expect(cut.every(Boolean), `cut-off cells of ${path} at ${width} px`).toBe(true)
    }
  })
}

test('closing the open alert from its detail closes the detail, and going back does not reopen it', async ({ page }) => {
  await page.goto('/alerts')
  const row = list(page).locator('tbody tr', { has: page.locator('[data-status="open"]') }).first()
  await expect(row).toBeVisible()
  const id = await row.getAttribute('data-alert')
  await row.getByRole('link', { name: new RegExp(`\\(${id}\\)$`) }).click()
  await expect(page).toHaveURL(new RegExp(`/alerts/${id}$`))
  const detail = page.getByRole('article', { name: `Alert ${id}` })
  await detail.getByRole('button', { name: 'Close…', exact: true }).click()
  await page.getByRole('dialog', { name: `Close alert ${id}` }).getByRole('button', { name: 'Close', exact: true }).click()

  await expect(detail).toHaveCount(0)
  await expect(page).toHaveURL(/\/alerts$/)
  await expect(list(page).locator(`tr[data-alert="${id}"]`)).toHaveCount(0)
  await page.goBack()
  await expect(page.getByRole('article', { name: `Alert ${id}` })).toHaveCount(0)
})
