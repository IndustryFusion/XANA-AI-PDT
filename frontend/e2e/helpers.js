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

/** Playback speed used by end-to-end tests, so every scenario finishes in seconds. */
export const E2E_SPEED = 25

/** Starts a run of `scenario` from the new-incident form and waits for its run view. */
export async function startScenario(page, scenario, { machine = 'press-brake-01', issue = `Scenario ${scenario}`, controls = {} } = {}) {
  await presetControls(page, { authEnabled: false, scenario, speed: E2E_SPEED, ...controls })
  await page.goto(`/incidents?new=1&machine=${encodeURIComponent(`urn:ngsi-ld:Machine:${machine}`)}`)
  await page.getByLabel('Issue').fill(issue)
  await page.getByRole('button', { name: 'Start analysis' }).click()
  await expect(page).toHaveURL(/\/incidents\/run-\d+$/)
}

/** Expects the run view to show `status` (the run's state value). */
export async function expectStatus(page, status) {
  await expect(page.locator('.run-header [data-status]')).toHaveAttribute('data-status', status)
}

/** Escalates the shown run through the pre-flight dialog. */
export async function escalate(page) {
  await page.getByRole('button', { name: 'Escalate to machine builder…' }).click()
  const dialog = page.getByRole('dialog', { name: 'Escalate to the machine builder' })
  await dialog.getByRole('button', { name: 'Escalate' }).click()
  await expect(dialog).toHaveCount(0)
  await expectStatus(page, 'awaiting_machine_builder')
}

/** Sends a structured act from the conversation composer. */
export async function sendAct(page, act, { text, outcome } = {}) {
  const form = page.getByRole('form', { name: 'Send to the machine builder' })
  await form.getByLabel('Act').selectOption({ label: act })
  if (outcome) await form.getByLabel('Outcome').selectOption({ label: outcome })
  if (text) await form.getByLabel(/^Message/).fill(text)
  await form.getByRole('button', { name: 'Send' }).click()
}

export const panel = (page, name) => page.getByRole('region', { name, exact: true })
export const thread = (page) => page.getByRole('region', { name: 'Message thread' })

/**
 * Buttons that sit in the same row as a text input or select but are not
 * level with it (top or bottom edge off by more than 1 px). Returns a short
 * description of each, so a failing test names the culprits.
 */
export function misalignedControls(page) {
  return page.evaluate(() => {
    const CONTROL = 'input:not([type=checkbox]):not([type=radio]):not([type=file]):not([type=range]), select'
    const shown = (el) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0 }
    const found = []
    for (const row of document.querySelectorAll('body *')) {
      const style = getComputedStyle(row)
      if (!(style.display.includes('flex') && !style.flexDirection.startsWith('column')) && !style.display.includes('grid')) continue
      const kids = [...row.children].filter(shown)
      const controls = kids.flatMap((k) => (k.matches(CONTROL) ? [k] : (k.querySelectorAll(CONTROL).length === 1 && !k.querySelector('button') ? [k.querySelector(CONTROL)] : [])))
      const buttons = kids.filter((k) => k.matches('button, .btn'))
      for (const b of buttons) {
        const br = b.getBoundingClientRect()
        for (const c of controls.filter(shown)) {
          const cr = c.getBoundingClientRect()
          if (!(br.top < cr.bottom && cr.top < br.bottom)) continue
          if (Math.abs(br.top - cr.top) > 1 || Math.abs(br.bottom - cr.bottom) > 1) {
            found.push(`"${(b.textContent || b.getAttribute('aria-label') || '').trim()}" vs "${(c.labels?.[0]?.textContent || c.getAttribute('aria-label') || c.name || '').trim()}"`)
          }
        }
      }
    }
    return [...new Set(found)]
  })
}
