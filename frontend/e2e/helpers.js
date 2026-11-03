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
