import { test, expect } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'
import { AREAS, E2E_SPEED, escalate, expectStatus, presetControls } from './helpers'

const violations = async (page) => {
  const results = await new AxeBuilder({ page }).exclude('.dev-controls__toggle').analyze()
  return results.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target).join(', ')}`)
}

/** Starts a run of the preset scenario from the new-incident form. */
async function startRun(page, machine = 'press-brake-01') {
  await page.goto(`/incidents?new=1&machine=urn:ngsi-ld:Machine:${machine}`)
  await page.getByLabel('Issue').fill('Accessibility check')
  await page.getByRole('button', { name: 'Start analysis' }).click()
  await expect(page).toHaveURL(/\/incidents\/run-\d+$/)
}

/** Run-view states checked in both themes: scenario for new runs, and how to reach the state. */
const RUN_STATES = [
  ['needs input', null, async (page) => { await page.goto('/incidents/run-1002'); await expectStatus(page, 'awaiting_input') }],
  ['confirm resolution with a rejected proposal', null, async (page) => {
    await page.goto('/incidents/run-1004')
    await page.getByRole('button', { name: 'Reject…' }).click()
    await page.getByLabel('Reason for rejecting').fill('Replaced yesterday.')
    await page.getByRole('button', { name: 'Submit rejection' }).click()
    await expect(page.getByRole('region', { name: 'Previously rejected resolutions' })).toBeVisible()
  }],
  ['running with expanded step', null, async (page) => {
    await page.goto('/incidents/run-1001')
    await page.getByRole('button', { name: 'Show details of Observe step' }).click()
  }],
  ['escalation pre-flight dialog', null, async (page) => {
    await page.goto('/incidents/run-1002')
    await page.getByRole('button', { name: 'Escalate to machine builder…' }).click()
    await expect(page.getByRole('dialog').getByText('Formwerk Press Technology')).toBeVisible()
  }],
  ['conversation awaiting the machine builder', null, async (page) => {
    await page.goto('/incidents/run-1003')
    await expect(page.getByRole('region', { name: 'Message thread' })).toContainText('Policy check')
  }],
  ['operator approval', 'request_beyond_tier', async (page) => {
    await startRun(page, 'chiller-01')
    await escalate(page).catch(() => {}) // the run moves on past awaiting_machine_builder quickly
    await expectStatus(page, 'awaiting_operator_approval')
  }],
  ['recommendation review', 'mb_recommendation', async (page) => {
    await startRun(page, 'chiller-01')
    await escalate(page).catch(() => {}) // the run moves on past awaiting_machine_builder quickly
    await expectStatus(page, 'awaiting_recommendation_review')
  }],
  ['closed by the machine builder', 'mb_closes', async (page) => {
    await startRun(page, 'extractor-01')
    await escalate(page)
    await expect(page.getByRole('region', { name: 'Message thread' })).toContainText('on site')
    await expect(async () => {
      await page.getByRole('button', { name: 'Check status' }).click()
      await expectStatus(page, 'mb_closed')
    }).toPass()
  }],
  ['completed', 'happy_path', async (page) => {
    await startRun(page)
    await page.getByRole('button', { name: 'Confirm resolution' }).click()
    await expectStatus(page, 'completed')
  }],
  ['failed', 'failure', async (page) => { await startRun(page); await expectStatus(page, 'failed') }],
  ['new-incident form with errors', null, async (page) => {
    await page.goto('/incidents?new=1')
    await page.getByRole('button', { name: 'Start analysis' }).click()
    await expect(page.getByText('Enter the machine ID.')).toBeVisible()
  }],
  ['incident history with detail and trace', null, async (page) => {
    await page.goto('/history/32')
    await page.getByRole('button', { name: 'Show details of Decide step' }).click()
    await expect(page.getByRole('region', { name: 'Input of Decide step' })).toBeVisible()
  }],
]

const SENSOR = '/explorer/urn%3Angsi-ld%3ASensor%3Achiller-01-flow?type=Sensor'

/** Data explorer and alerts views checked in both themes. */
const EXPLORER_ALERT_STATES = [
  ['explorer entity view with query builder', async (page) => {
    await page.goto('/explorer/urn%3Angsi-ld%3AFactory%3Aplant-north?type=Machine&q=status%3D%3D%22running%22')
    await expect(page.getByRole('heading', { level: 2, name: 'Plant North' })).toBeVisible()
  }],
  ['explorer attribute editor with suggestions and context menu', async (page) => {
    await page.goto('/explorer/urn%3Angsi-ld%3AMachine%3Apress-brake-01')
    await page.getByRole('button', { name: 'Edit status' }).click()
    await expect(page.getByRole('group', { name: 'Suggested values' })).toBeVisible()
    await page.getByRole('button', { name: 'Actions for urn:ngsi-ld:ProductionLine:line-b' }).click()
  }],
  ['explorer raw JSON', async (page) => {
    await page.goto(SENSOR)
    await page.getByRole('tab', { name: 'Raw JSON' }).click()
    await expect(page.getByLabel('Entity JSON')).toBeVisible()
  }],
  ['explorer history with chart and table', async (page) => {
    await page.goto(SENSOR)
    await page.getByRole('button', { name: 'History of value' }).click()
    await expect(page.getByRole('region', { name: 'History of value' }).locator('.recharts-line-curve')).toBeVisible()
  }],
  ['explorer historical view', async (page) => {
    await page.goto(`${SENSOR}&at=${encodeURIComponent(new Date(Date.now() - 2 * 864e5).toISOString())}`)
    await expect(page.getByRole('region', { name: 'Historical view' })).toBeVisible()
    await expect(page.getByRole('heading', { level: 2, name: 'Process chiller 01 flow' })).toBeVisible()
  }],
  ['explorer import preview dialog', async (page) => {
    await page.goto('/explorer')
    await page.getByRole('button', { name: 'Import…' }).click()
    await page.getByRole('dialog').getByLabel('File with NGSI-LD entities (JSON)').setInputFiles({ name: 'x.json', mimeType: 'application/json', buffer: Buffer.from('[{"id":"urn:ngsi-ld:Machine:x","type":"Machine"}]') })
    await expect(page.getByRole('dialog').getByRole('region', { name: 'Preview' })).toBeVisible()
  }],
  ['explorer delete-by-type dialog', async (page) => {
    await page.goto('/explorer')
    await page.getByRole('button', { name: 'Delete by type…' }).click()
    await expect(page.getByRole('dialog').getByLabel('Sensor')).toBeVisible()
  }],
  ['explorer delete confirmation', async (page) => {
    await page.goto(SENSOR)
    await page.getByRole('button', { name: 'Delete sub-attribute accuracy of value' }).click()
    await expect(page.getByRole('dialog')).toBeVisible()
  }],
  ['alerts list with selection and summary filter', async (page) => {
    await page.goto('/alerts?severity=minor')
    await page.getByLabel('Select all listed alerts').check()
    await expect(page.getByRole('region', { name: 'Selected alerts' })).toBeVisible()
  }],
  ['alert detail with history', async (page) => {
    await page.goto('/alerts/alert-001?status=open%2Cack%2Cshelved%2Cclosed')
    await expect(page.getByRole('article', { name: 'Alert alert-001' })).toBeVisible()
  }],
  ['alert action dialog', async (page) => {
    await page.goto('/alerts/alert-001')
    await page.getByRole('article', { name: 'Alert alert-001' }).getByRole('button', { name: 'Close…' }).click()
    await expect(page.getByRole('dialog')).toBeVisible()
  }],
]

for (const theme of ['dark', 'light']) {
  test.describe(`${theme} theme: data explorer and alerts`, () => {
    test.use({ colorScheme: theme })

    for (const [name, arrange] of EXPLORER_ALERT_STATES) {
      test(`${name} has no accessibility violations`, async ({ page }) => {
        await presetControls(page, { authEnabled: false, newAlerts: false, liveUpdates: 'unavailable' })
        await arrange(page)
        await expect(page.getByText(/^Loading/)).toHaveCount(0)
        expect(await violations(page)).toEqual([])
      })
    }
  })
}

for (const theme of ['dark', 'light']) {
  test.describe(`${theme} theme: incident workflow`, () => {
    test.use({ colorScheme: theme })

    for (const [name, scenario, arrange] of RUN_STATES) {
      test(`${name} has no accessibility violations`, async ({ page }) => {
        await presetControls(page, { authEnabled: false, speed: E2E_SPEED, ...(scenario ? { scenario } : {}) })
        await arrange(page)
        await expect(page.getByText(/^Loading/)).toHaveCount(0)
        expect(await violations(page)).toEqual([])
      })
    }
  })

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

test('keyboard only: clarify, open and leave the escalation dialog, and use the conversation', async ({ page }) => {
  await presetControls(page, { authEnabled: false, speed: E2E_SPEED })
  await page.goto('/incidents/run-1002')
  const clarification = page.getByLabel('Your clarification')
  await clarification.focus()
  await page.keyboard.press('Tab')
  await expect(page.getByLabel('Attach files (optional)')).toBeFocused()
  await page.keyboard.press('Tab')
  await page.keyboard.press('Tab')
  const escalateButton = page.getByRole('button', { name: 'Escalate to machine builder…' })
  await expect(escalateButton).toBeFocused()
  await page.keyboard.press('Enter')
  const dialog = page.getByRole('dialog', { name: 'Escalate to the machine builder' })
  await expect(dialog).toBeVisible()
  await expect(dialog.getByRole('button', { name: 'Close dialog' })).toBeFocused()
  await page.keyboard.press('Escape')
  await expect(dialog).toHaveCount(0)
  await expect(escalateButton).toBeFocused()

  await page.keyboard.press('Shift+Tab')
  await page.keyboard.press('Enter')
  await expect(page.getByText('Enter a clarification or attach a file.')).toBeVisible()
  await clarification.focus()
  await page.keyboard.type('Only on long parts.')
  await page.keyboard.press('Tab')
  await page.keyboard.press('Tab')
  await expect(page.getByRole('button', { name: 'Submit clarification' })).toBeFocused()
  await page.keyboard.press('Enter')
  await expect(page.getByRole('region', { name: 'Confirm the proposed resolution' })).toBeVisible()

  await page.goto('/incidents/run-1003')
  const tab = page.getByRole('tab', { name: 'Conversation' })
  await tab.focus()
  await page.keyboard.press('ArrowLeft')
  await expect(page.getByRole('tab', { name: 'Diagnostics' })).toBeFocused()
  await expect(page.getByRole('region', { name: 'Agent steps' })).toBeVisible()
  await page.keyboard.press('ArrowRight')
  const act = page.getByLabel('Act', { exact: true })
  await act.focus()
  await page.keyboard.press('ArrowDown')
  await expect(act).toHaveValue('request')
  await page.keyboard.press('Tab')
  await page.keyboard.type('Is a spare part needed?')
  await page.keyboard.press('Tab')
  await page.keyboard.press('Enter')
  await expect(page.getByRole('region', { name: 'Message thread' })).toContainText('May our technician open a remote session')
  const outline = await page.getByRole('button', { name: 'Send' }).evaluate((el) => { el.focus(); return getComputedStyle(el).outlineStyle })
  expect(outline).not.toBe('none')
})

test('keyboard only: query, open an entity, edit with a suggestion, and act on an alert', async ({ page }) => {
  await presetControls(page, { authEnabled: false, newAlerts: false })
  await page.goto('/explorer')
  const type = page.getByLabel('Entity type')
  await expect(type.locator('option', { hasText: 'Machine' })).toHaveCount(1)
  await type.focus()
  await page.keyboard.press('M')
  await expect(type).toHaveValue('Machine')
  await page.getByRole('button', { name: 'Apply query' }).focus()
  await page.keyboard.press('Enter')
  const link = page.getByRole('region', { name: 'Entities' }).getByRole('link', { name: /Press brake 01/ })
  await link.focus()
  await page.keyboard.press('Enter')
  await expect(page.getByRole('heading', { level: 2, name: 'Press brake 01' })).toBeVisible()
  await page.getByRole('button', { name: 'Edit status' }).focus()
  await page.keyboard.press('Enter')
  await expect(page.getByLabel('New value of status')).toBeFocused()
  await expect(page.getByRole('group', { name: 'Suggested values' })).toBeVisible()
  await page.keyboard.press('Tab')
  const suggestion = page.getByRole('group', { name: 'Suggested values' }).getByRole('button').first()
  await expect(suggestion).toBeFocused()
  const value = await suggestion.textContent()
  await page.keyboard.press('Enter')
  await expect(page.getByLabel('New value of status')).toHaveValue(value)
  await page.getByLabel('New value of status').press('Enter')
  await expect(page.locator('[data-attribute="status"]')).toContainText(value)

  await page.goto('/alerts/alert-001')
  const detail = page.getByRole('article', { name: 'Alert alert-001' })
  const close = detail.getByRole('button', { name: 'Close…' })
  await close.focus()
  await page.keyboard.press('Enter')
  const dialog = page.getByRole('dialog', { name: 'Close alert alert-001' })
  await expect(dialog.getByRole('button', { name: 'Close dialog' })).toBeFocused()
  await page.keyboard.press('Tab')
  await expect(dialog.getByLabel('Note (optional)')).toBeFocused()
  await page.keyboard.type('Resolved on site.')
  await page.keyboard.press('Tab')
  await page.keyboard.press('Tab')
  await page.keyboard.press('Enter')
  await expect(dialog).toHaveCount(0)
  await expect(detail.getByRole('region', { name: 'History' }).getByRole('listitem').last()).toContainText('Resolved on site.')
  const summary = page.getByRole('group', { name: 'Alerts by severity' }).getByRole('button').first()
  await summary.focus()
  await page.keyboard.press('Enter')
  await expect(summary).toHaveAttribute('aria-pressed', 'true')
  expect(await summary.evaluate((el) => getComputedStyle(el).outlineStyle)).not.toBe('none')
})
