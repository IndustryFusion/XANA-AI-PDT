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
  ['explorer entity node with query builder', async (page) => {
    await page.goto('/explorer/urn%3Angsi-ld%3AFactory%3Aplant-north?type=Machine&q=status%3D%3D%22running%22')
    await expect(page.getByRole('button', { name: 'Plant North', expanded: true })).toBeVisible()
    await expect(page.locator('[data-attribute="location"]')).toBeVisible()
  }],
  ['explorer in-place editor with suggestions and context menu', async (page) => {
    await page.goto('/explorer/urn%3Angsi-ld%3AMachine%3Apress-brake-01?type=Machine')
    await page.getByRole('button', { name: /^Value of status:/ }).click()
    await expect(page.getByRole('listbox', { name: 'Suggested values' })).toBeVisible()
    await page.getByRole('combobox', { name: 'New value of status' }).press('ArrowDown')
    await page.locator('[data-attribute="partOf"]').getByRole('button', { name: 'Actions for urn:ngsi-ld:ProductionLine:line-b' }).click()
  }],
  ['explorer rejected change', async (page) => {
    await page.goto(SENSOR)
    await page.getByRole('button', { name: 'Edit value' }).click()
    await page.getByRole('combobox', { name: 'New value of value' }).fill('high')
    await page.getByRole('button', { name: 'Save value' }).click()
    await expect(page.getByText('Not saved: value must be a number.')).toBeVisible()
  }],
  ['explorer nested relationship and sub-attributes', async (page) => {
    await page.goto(SENSOR)
    await page.getByRole('button', { name: '2 sub-attributes of value' }).click()
    await page.getByRole('button', { name: 'Expand urn:ngsi-ld:Machine:chiller-01 in place' }).click()
    const nested = page.locator('.attr-line__nested [data-entity="urn:ngsi-ld:Machine:chiller-01"]')
    await nested.getByRole('button', { name: 'Expand urn:ngsi-ld:ProductionLine:line-a in place' }).click()
    await expect(nested.getByRole('heading', { level: 5, name: /Line A/ })).toBeVisible()
    await expect(page.locator('[data-attribute="value.accuracy"]')).toBeVisible()
  }],
  ['explorer inline add-attribute forms', async (page) => {
    await page.goto('/explorer/urn%3Angsi-ld%3AMachine%3Apress-brake-01')
    await page.getByRole('button', { name: 'Add attribute to Press brake 01' }).click()
    await page.getByRole('button', { name: 'Add sub-attribute to status' }).click()
    await expect(page.getByRole('form', { name: 'Add a sub-attribute to status' })).toBeVisible()
  }],
  ['explorer raw JSON editor with an error', async (page) => {
    await page.goto(SENSOR)
    await page.getByRole('button', { name: 'Raw JSON of Process chiller 01 flow' }).click()
    await page.getByLabel('Entity JSON').fill('{')
    await page.getByRole('button', { name: 'Save JSON' }).click()
    await expect(page.getByText('The JSON is not valid', { exact: false })).toBeVisible()
  }],
  ['explorer history with chart and table', async (page) => {
    await page.goto(SENSOR)
    await page.getByRole('button', { name: 'History of value' }).click()
    await expect(page.getByRole('region', { name: 'History of value' }).locator('.recharts-line-curve')).toBeVisible()
  }],
  ['explorer historical view', async (page) => {
    await page.goto(`${SENSOR}&at=${encodeURIComponent(new Date(Date.now() - 2 * 864e5).toISOString())}`)
    await expect(page.getByRole('region', { name: 'Historical view' })).toBeVisible()
    await expect(page.locator('[data-attribute="value"]').first()).toBeVisible()
    await page.getByRole('button', { name: 'Raw JSON of Process chiller 01 flow' }).click()
    await expect(page.getByLabel('Entity JSON')).toBeVisible()
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
    await page.getByRole('button', { name: '2 sub-attributes of value' }).click()
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
  ['alert row context menu', async (page) => {
    await page.goto('/alerts')
    await page.locator('tr[data-alert="alert-001"] td').nth(5).click({ button: 'right' })
    await expect(page.getByRole('menu', { name: 'Actions for alert alert-001' })).toBeVisible()
  }],
]

const MARKDOWN = { name: 'Checklist.md', mimeType: 'text/markdown', buffer: Buffer.from('# Checks\nInspect the nozzle.') }
const kb = (page) => page.getByRole('region', { name: 'Knowledge base' })

/** Dataspace and System views checked in both themes: extra controls preset, and how to reach the state. */
const DATASPACE_SYSTEM_STATES = [
  ['dataspace with a selected peer and requests', {}, async (page) => {
    await page.goto('/dataspace?peer=peer-formwerk')
    await expect(page.getByRole('table', { name: 'What Formwerk Press Technology may access here' })).toBeVisible()
    await expect(page.locator('tr[data-request="req-003"]')).toContainText('HydroService Maintenance')
  }],
  ['dataspace disconnect dialog', {}, async (page) => {
    await page.goto('/dataspace')
    await page.getByRole('button', { name: 'Disconnect…' }).click()
    await expect(page.getByRole('dialog')).toBeVisible()
  }],
  ['dataspace connect form with an error', { connection: 'disconnected' }, async (page) => {
    await page.goto('/dataspace')
    await page.getByLabel('Dataspace credential').fill('wrong')
    await page.getByRole('button', { name: 'Connect' }).click()
    await expect(page.getByRole('region', { name: 'Connection' }).getByRole('alert')).toBeVisible()
  }],
  ['dataspace not configured', { connection: 'not_configured' }, async (page) => {
    await page.goto('/dataspace')
    await expect(page.getByText('Not available: no dataspace connection is configured.')).toBeVisible()
  }],
  ['dataspace failing', { failure: { dataspace: 'unavailable' } }, async (page) => {
    await page.goto('/dataspace')
    await expect(page.getByText('Could not load the dataspace connection')).toBeVisible()
  }],
  ['dataspace policy confirmation', {}, async (page) => {
    await page.goto('/dataspace?peer=peer-formwerk')
    await page.getByRole('button', { name: 'Grant Signal history for Formwerk Press Technology' }).click()
    await expect(page.getByRole('dialog')).toBeVisible()
  }],
  ['dataspace request decision dialog', {}, async (page) => {
    await page.goto('/dataspace')
    await page.getByRole('button', { name: /Deny request req-004/ }).click()
    await expect(page.getByRole('dialog').getByLabel('Note (optional)')).toBeVisible()
  }],
  ['system with a failing dependency and an invalid setting', { gatewayReachable: false }, async (page) => {
    await page.goto('/system')
    await expect(page.getByText('Overall health: Degraded')).toBeVisible()
    await page.getByLabel('Context broker', { exact: true }).fill('broker')
    await page.getByRole('button', { name: 'Save settings' }).click()
    await expect(page.getByText('Not saved: correct the marked addresses.')).toBeVisible()
  }],
  ['system with a changed setting', {}, async (page) => {
    await page.goto('/system')
    await page.getByLabel('Alert manager', { exact: true }).fill('https://alerts-2.example.org')
    await page.getByRole('button', { name: 'Save settings' }).click()
    await expect(page.getByRole('button', { name: 'Reset to deployment value: Alert manager' })).toBeVisible()
  }],
  ['knowledge base with an upload in progress, a refused file and the drop zone', { speed: 0.5 }, async (page) => {
    await page.goto('/system')
    await kb(page).getByLabel('Or choose files').setInputFiles([MARKDOWN, { name: 'photo.png', mimeType: 'image/png', buffer: Buffer.from('x') }])
    await expect(kb(page).getByRole('progressbar', { name: 'Ingestion progress of Checklist.md' })).toBeVisible()
    await expect(kb(page).getByRole('alert')).toContainText('photo.png was refused')
  }],
  ['knowledge base structured pipeline with a description being edited', {}, async (page) => {
    await page.goto('/system')
    await kb(page).getByRole('radio', { name: /Structured pipeline/ }).check()
    await kb(page).getByRole('button', { name: 'Edit description of PB-2200 spare parts catalogue.pdf' }).click()
    await expect(kb(page).getByLabel('Description of PB-2200 spare parts catalogue.pdf', { exact: true })).toBeVisible()
  }],
  ['knowledge base delete dialog', {}, async (page) => {
    await page.goto('/system')
    await kb(page).getByRole('button', { name: 'Delete Scanned wiring diagrams.pdf' }).click()
    await expect(page.getByRole('dialog')).toBeVisible()
  }],
  ['knowledge base test query results', {}, async (page) => {
    await page.goto('/system')
    await kb(page).getByLabel('Question').fill('hydraulic pressure drop')
    await kb(page).getByRole('button', { name: 'Run test query' }).click()
    await expect(kb(page).getByRole('list', { name: 'Retrieved passages' })).toBeVisible()
  }],
]

for (const theme of ['dark', 'light']) {
  test.describe(`${theme} theme: dataspace and system`, () => {
    test.use({ colorScheme: theme })

    for (const [name, controls, arrange] of DATASPACE_SYSTEM_STATES) {
      test(`${name} has no accessibility violations`, async ({ page }) => {
        await presetControls(page, { authEnabled: false, speed: E2E_SPEED, ...controls })
        await arrange(page)
        await expect(page.getByText(/^Loading/)).toHaveCount(0)
        expect(await violations(page)).toEqual([])
      })
    }
  })
}

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

test('keyboard only: query, expand an entity, edit with a suggestion, cancel, and act on an alert', async ({ page }) => {
  await presetControls(page, { authEnabled: false, newAlerts: false })
  await page.goto('/explorer')
  const type = page.getByLabel('Entity type')
  await expect(type.locator('option', { hasText: 'Machine' })).toHaveCount(1)
  await type.focus()
  await page.keyboard.press('M')
  await expect(type).toHaveValue('Machine')
  await page.getByRole('button', { name: 'Apply query' }).focus()
  await page.keyboard.press('Enter')
  const toggle = page.getByRole('region', { name: 'Entities' }).getByRole('button', { name: 'Press brake 01', exact: true })
  await toggle.focus()
  expect(await toggle.evaluate((el) => getComputedStyle(el).outlineStyle)).not.toBe('none')
  await page.keyboard.press('Enter')
  await expect(toggle).toHaveAttribute('aria-expanded', 'true')
  const status = page.locator('[data-attribute="status"]').first()
  const valueButton = status.getByRole('button', { name: /^Value of status:/ })
  const before = (await status.locator('.attr-line__value').textContent()).replace('Value of status: ', '')

  await valueButton.focus()
  await page.keyboard.press('Enter')
  const input = page.getByRole('combobox', { name: 'New value of status' })
  await expect(input).toBeFocused()
  const first = page.getByRole('listbox', { name: 'Suggested values' }).getByRole('option').first()
  await expect(first).toBeVisible()
  await page.keyboard.press('ArrowDown')
  await expect(first).toHaveAttribute('aria-selected', 'true')
  await page.keyboard.press('Escape')
  await expect(input).toHaveCount(0)
  await expect(status.locator('.attr-line__value')).toContainText(before)

  await valueButton.focus()
  await page.keyboard.press(' ')
  await expect(input).toBeFocused()
  await expect(first).toBeVisible()
  await page.keyboard.press('ArrowDown')
  const value = await first.textContent()
  await page.keyboard.press('Enter')
  await expect(input).toHaveValue(value)
  await page.keyboard.press('Enter')
  await expect(input).toHaveCount(0)
  await expect(status).toContainText(`"${value}"`)

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

test('keyboard only: connect, decide a request, change a policy and upload with the file picker', async ({ page }) => {
  await presetControls(page, { authEnabled: false, speed: E2E_SPEED, connection: 'disconnected' })
  await page.goto('/dataspace')
  const credential = page.getByLabel('Dataspace credential')
  await credential.focus()
  await page.keyboard.type('plant-north-secret')
  await page.keyboard.press('Enter')
  await expect(page.getByRole('region', { name: 'Connection' }).getByText('Dataspace connected')).toBeVisible()

  const peer = page.getByRole('region', { name: 'Compatible peers' }).getByRole('link', { name: /CoolFlow Process Cooling/ })
  await peer.focus()
  await page.keyboard.press('Enter')
  const deny = page.getByRole('button', { name: 'Deny Signal history for CoolFlow Process Cooling' })
  await deny.focus()
  await page.keyboard.press('Enter')
  const dialog = page.getByRole('dialog', { name: 'Deny: Signal history for CoolFlow Process Cooling' })
  await expect(dialog.getByRole('button', { name: 'Close dialog' })).toBeFocused()
  await page.keyboard.press('Escape')
  await expect(dialog).toHaveCount(0)
  await expect(deny).toBeFocused()
  await page.keyboard.press('Enter')
  await page.keyboard.press('Tab')
  await page.keyboard.press('Tab')
  await expect(dialog.getByRole('button', { name: 'Deny' })).toBeFocused()
  await page.keyboard.press('Enter')
  await expect(page.getByRole('table', { name: 'What CoolFlow Process Cooling may access here' }).locator('tr[data-capability="twin:history"]')).toContainText('Denied')

  const approve = page.getByRole('button', { name: /Approve request req-003/ })
  await approve.focus()
  await page.keyboard.press('Enter')
  const decision = page.getByRole('dialog', { name: 'Approve request req-003' })
  await page.keyboard.press('Tab')
  await expect(decision.getByLabel('Note (optional)')).toBeFocused()
  await page.keyboard.type('Trial for three months.')
  await page.keyboard.press('Tab')
  await page.keyboard.press('Tab')
  await page.keyboard.press('Enter')
  await expect(page.locator('tr[data-request="req-003"]')).toContainText('Approved')

  await page.goto('/system')
  await page.getByRole('radio', { name: /Base pipeline/ }).focus()
  await page.keyboard.press('ArrowRight')
  await expect(page.getByRole('radio', { name: /Structured pipeline/ })).toBeChecked()
  const picker = page.getByLabel('Or choose files')
  await picker.focus()
  expect(await picker.evaluate((el) => getComputedStyle(el).outlineStyle)).not.toBe('none')
  const chooser = page.waitForEvent('filechooser')
  await page.keyboard.press('Space')
  await (await chooser).setFiles(MARKDOWN)
  const row = page.locator('tr[data-document="Checklist.md"]')
  await expect(row.getByText('Done')).toBeVisible()
  await expect(page.getByRole('table', { name: 'Documents in the structured pipeline' })).toContainText('Checklist.md')
})
