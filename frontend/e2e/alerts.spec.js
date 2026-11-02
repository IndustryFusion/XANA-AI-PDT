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

  await detail.getByRole('link', { name: 'Start new incident from this alert' }).click()
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
