import { test, expect } from '@playwright/test'
import { AREAS, openSignedIn, presetControls } from './helpers'

test.beforeEach(async ({ page }) => {
  await presetControls(page, { authEnabled: false })
})

test('every area is reachable from the navigation and marked as current', async ({ page }) => {
  await page.goto('/')
  const nav = page.getByRole('navigation', { name: 'Main' })
  for (const [path, label] of AREAS) {
    await nav.getByRole('link', { name: label }).click()
    await expect(page).toHaveURL(new RegExp(`${path === '/' ? '/$' : path + '$'}`))
    await expect(nav.getByRole('link', { name: label })).toHaveAttribute('aria-current', 'page')
    await expect(page.getByRole('heading', { level: 1, name: label })).toBeVisible()
  }
})

test('areas of later changes show a placeholder', async ({ page }) => {
  for (const [path, label] of AREAS.filter(([p]) => !['/', '/incidents', '/history'].includes(p))) {
    await page.goto(path)
    await expect(page.getByText(`${label} is not available yet.`)).toBeVisible()
  }
})

test('opening an item URL directly and reloading keeps the view', async ({ page }) => {
  const id = 'urn:ngsi-ld:Machine:press-brake-02'
  await page.goto(`/explorer/${encodeURIComponent(id)}`)
  await expect(page.getByText(id)).toBeVisible()
  await page.reload()
  await expect(page.getByText(id)).toBeVisible()
  await expect(page.getByRole('link', { name: 'Data explorer' })).toHaveAttribute('aria-current', 'page')
})

test('unknown URLs show not found', async ({ page }) => {
  await page.goto('/no/such/page')
  await expect(page.getByRole('heading', { name: 'Page not found' })).toBeVisible()
  await page.getByRole('link', { name: 'Go to the dashboard' }).click()
  await expect(page.getByRole('heading', { level: 1, name: 'Dashboard' })).toBeVisible()
})

test('browser back and forward move between visited views', async ({ page }) => {
  await page.goto('/')
  const nav = page.getByRole('navigation', { name: 'Main' })
  await nav.getByRole('link', { name: 'Alerts' }).click()
  await nav.getByRole('link', { name: 'System' }).click()
  await page.goBack()
  await expect(page.getByRole('heading', { level: 1, name: 'Alerts' })).toBeVisible()
  await page.goBack()
  await expect(page.getByRole('heading', { level: 1, name: 'Dashboard' })).toBeVisible()
  await page.goForward()
  await expect(page.getByRole('heading', { level: 1, name: 'Alerts' })).toBeVisible()
})

test('dashboard incidents lead to their run; entity actions prefill a new incident', async ({ page }) => {
  await page.goto('/')
  const tile = page.getByRole('region', { name: 'Active incidents' })
  await tile.getByRole('link', { name: /Hydraulic pressure/ }).click()
  await expect(page).toHaveURL(/\/incidents\/run-1002$/)
  await expect(page.getByRole('heading', { level: 2, name: 'Incident #42' })).toBeVisible()
  await expect(page.getByRole('region', { name: 'Open runs' }).getByRole('link', { name: /Hydraulic pressure/ })).toHaveAttribute('aria-current', 'true')
  await expect(page.getByRole('region', { name: 'The agent needs more information' })).toBeVisible()

  await page.goBack()
  await tile.getByRole('button', { name: 'Actions for press-brake-02' }).click()
  await tile.getByRole('link', { name: 'Start new incident' }).click()
  await expect(page).toHaveURL(/\/incidents\?new=1&machine=urn%3Angsi-ld%3AMachine%3Apress-brake-02$/)
  await expect(page.getByLabel('Machine ID')).toHaveValue('urn:ngsi-ld:Machine:press-brake-02')
  await expect(page.getByLabel('Issue')).toBeFocused()
})

test('expired dataspace session shows a reconnect hint', async ({ page }) => {
  await page.goto('/')
  await page.evaluate(() => {
    const c = JSON.parse(localStorage.getItem('xana.mock.controls'))
    localStorage.setItem('xana.mock.controls', JSON.stringify({ ...c, connection: 'expired' }))
  })
  await page.reload()
  await page.getByRole('banner').getByRole('link', { name: 'Reconnect' }).click()
  await expect(page.getByRole('heading', { level: 1, name: 'Dataspace' })).toBeVisible()
})

test('signed-in flow works end to end with authentication enabled', async ({ page, context }) => {
  await context.clearCookies()
  await page.addInitScript(() => localStorage.removeItem('xana.mock.controls'))
  await openSignedIn(page, '/')
  await expect(page.getByRole('heading', { level: 1, name: 'Dashboard' })).toBeVisible()
})
