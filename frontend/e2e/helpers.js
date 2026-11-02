import { expect } from '@playwright/test'

export const CONTROLS_KEY = 'xana.mock.controls'

/** Presets mock dev controls before the app loads. */
export async function presetControls(page, controls) {
  await page.addInitScript(([key, value]) => {
    if (!sessionStorage.getItem('xana.e2e.preset')) {
      localStorage.setItem(key, JSON.stringify(value))
      sessionStorage.setItem('xana.e2e.preset', '1')
    }
  }, [CONTROLS_KEY, controls])
}

/** Changes mock dev controls in a running page (applies to the next request). */
export async function setControls(page, patch) {
  await page.evaluate(([key, value]) => {
    const current = JSON.parse(localStorage.getItem(key) || '{}')
    localStorage.setItem(key, JSON.stringify({ ...current, ...value }))
  }, [CONTROLS_KEY, patch])
}

export async function signIn(page, { username = 'operator', password = 'operator' } = {}) {
  await page.getByLabel('Username').fill(username)
  await page.getByLabel('Password').fill(password)
  await page.getByRole('button', { name: 'Sign in' }).click()
}

/** Opens `path` and signs in, ending on the requested screen. */
export async function openSignedIn(page, path = '/') {
  await page.goto(path)
  await signIn(page)
  await expect(page.getByRole('navigation', { name: 'Main' })).toBeVisible()
}

export const AREAS = [
  ['/', 'Dashboard'],
  ['/incidents', 'Active incidents'],
  ['/explorer', 'Data explorer'],
  ['/alerts', 'Alerts'],
  ['/history', 'Incident history'],
  ['/dataspace', 'Dataspace'],
  ['/system', 'System'],
]
