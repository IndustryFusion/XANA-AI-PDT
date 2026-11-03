import { test, expect } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'
import { AREAS, presetControls } from './helpers'

for (const theme of ['dark', 'light']) {
  test.describe(`${theme} theme`, () => {
    test.use({ colorScheme: theme })

    test('sign-in screen has no accessibility violations', async ({ page }) => {
      await page.goto('/')
      await expect(page.getByLabel('Username')).toBeVisible()
      const results = await new AxeBuilder({ page }).analyze()
      expect(results.violations).toEqual([])
    })

    for (const [path, label] of AREAS) {
      test(`${label} has no accessibility violations`, async ({ page }) => {
        await presetControls(page, { authEnabled: false })
        await page.goto(path)
        await expect(page.getByRole('heading', { level: 1, name: label })).toBeVisible()
        await expect(page.getByText('Loading…')).toHaveCount(0)
        const results = await new AxeBuilder({ page }).exclude('.dev-controls__toggle').analyze()
        expect(results.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target).join(', ')}`)).toEqual([])
      })
    }
  })
}

test('keyboard only: sign in and move between areas', async ({ page }) => {
  await page.goto('/incidents')
  await expect(page.getByLabel('Username')).toBeVisible()
  await page.keyboard.press('Tab')
  await expect(page.getByLabel('Username')).toBeFocused()
  await page.keyboard.type('operator')
  await page.keyboard.press('Tab')
  await expect(page.getByLabel('Password')).toBeFocused()
  await page.keyboard.type('operator')
  await page.keyboard.press('Enter')
  await expect(page.getByRole('heading', { level: 1, name: 'Active incidents' })).toBeVisible()

  // Skip link, brand, then the navigation entries.
  await page.keyboard.press('Tab')
  await expect(page.getByRole('link', { name: 'Skip to content' })).toBeFocused()
  await page.keyboard.press('Tab')
  await page.keyboard.press('Tab')
  await expect(page.getByRole('link', { name: 'Dashboard', exact: true })).toBeFocused()
  await page.keyboard.press('Tab')
  await page.keyboard.press('Tab')
  await page.keyboard.press('Tab')
  await expect(page.getByRole('link', { name: 'Alerts' })).toBeFocused()
  await page.keyboard.press('Enter')
  await expect(page.getByRole('heading', { level: 1, name: 'Alerts' })).toBeVisible()

  const outline = await page.getByRole('link', { name: 'Alerts' }).evaluate((el) => getComputedStyle(el).outlineStyle)
  expect(outline).not.toBe('none')
})

test('theme choice applies immediately and survives reload', async ({ page }) => {
  await presetControls(page, { authEnabled: false })
  await page.goto('/')
  await page.getByLabel('Theme').selectOption('light')
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light')
  await page.reload()
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light')
})
