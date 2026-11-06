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

// The Alerts screen and run evidence on the backend data source, against a real Alerta with the
// sample alerts (the local environment with its `alerts` profile).
import { test, expect } from '@playwright/test'
import { expectStatus, presetControls } from '../helpers'

const MACHINE = 'urn:ngsi-ld:Machine:laser-cutter-01'
const tag = () => Date.now().toString(36)

test.beforeEach(async ({ page }) => {
  await presetControls(page, { authEnabled: false })
})

test('lists the alerts with filters, and a search for a full entity ID', async ({ page }) => {
  await page.goto('/alerts')
  await expect(page.getByRole('table')).toContainText('SHACL Validator')
  await page.getByLabel('Environment').selectOption('Development')
  await page.getByLabel('Service').selectOption('SHACL Validator')
  await page.getByLabel('Search').fill(MACHINE)
  await expect(page).toHaveURL(/text=urn/)
  await expect(page.getByRole('table')).toContainText(MACHINE.split(':').pop())
  await expect(page.getByRole('group', { name: 'Alerts by severity' })).toBeVisible()
})

/** An alert on a sample machine, set back to open. */
async function openAlert(page) {
  const list = await (await page.request.get(`/api/alerta/alerts?status=open,ack,shelved,closed&text=${encodeURIComponent(MACHINE)}`)).json()
  const { id, status } = list.alerts[0]
  const back = { ack: 'unack', shelved: 'unshelve', closed: 'open' }[status]
  if (back) expect((await page.request.put(`/api/alerta/alert/${id}/action`, { data: { action: back } })).status()).toBe(200)
  return id
}

test('acknowledge with a note, and see it in the history', async ({ page }) => {
  const id = await openAlert(page)
  const note = `seen ${tag()}`
  await page.goto(`/alerts/${id}`)
  await page.getByRole('button', { name: /^Acknowledge/ }).first().click()
  await page.getByRole('dialog').getByRole('textbox').fill(note)
  await page.getByRole('dialog').getByRole('button', { name: /Acknowledge/ }).click()
  await expect(page.getByText(note).first()).toBeVisible()
  expect((await (await page.request.get(`/api/alerta/alert/${id}`)).json()).status).toBe('ack')
  await page.request.put(`/api/alerta/alert/${id}/action`, { data: { action: 'unack' } })
})

test('a bulk action reports per alert, and what failed stays selected with the reason', async ({ page }) => {
  const id = await openAlert(page)
  const list = await (await page.request.get('/api/alerta/alerts?status=open')).json()
  const other = list.alerts.find((a) => a.id !== id)
  // One of the two is acknowledged already, so acknowledging it can't work.
  await page.request.put(`/api/alerta/alert/${other.id}/action`, { data: { action: 'ack' } })
  await page.goto('/alerts')
  await page.getByRole('checkbox', { name: `Select ${id}` }).check()
  await page.getByRole('checkbox', { name: `Select ${other.id}` }).check()
  await page.getByRole('region', { name: 'Selected alerts' }).getByRole('button', { name: /^Acknowledge/ }).click()
  await page.getByRole('dialog').getByRole('button', { name: /Acknowledge/ }).click()
  await expect(page.getByRole('heading', { name: 'Acknowledge: 1 succeeded, 1 failed' })).toBeVisible()
  await expect(page.getByRole('region', { name: 'Selected alerts' })).toContainText('1 selected')
  await page.request.put(`/api/alerta/alert/${id}/action`, { data: { action: 'unack' } })
  await page.request.put(`/api/alerta/alert/${other.id}/action`, { data: { action: 'unack' } })
})

test('the configured refresh interval applies until the operator chooses', async ({ page }) => {
  await page.route('**/api/alerta/config', (route) => route.fulfill({ json: { refresh_interval_s: 45 } }))
  await page.goto('/alerts')
  const refresh = page.getByLabel('Automatic refresh')
  await expect(refresh).toHaveValue('45000')
  await refresh.selectOption('10000')
  await page.reload()
  await expect(refresh).toHaveValue('10000')
  await page.evaluate(() => localStorage.removeItem('xana.alerts.refreshMs'))
})

test('an action that no longer fits reports the reason', async ({ page }) => {
  const id = await openAlert(page)
  const answer = await page.request.put(`/api/alerta/alert/${id}/action`, { data: { action: 'unshelve' } })
  expect(answer.status()).toBe(409)
  expect((await answer.json()).error.kind).toBe('conflict')
})

test('a run on a machine with an active alert shows it as evidence', async ({ page }) => {
  await page.goto('/incidents?new=1')
  await page.getByLabel('Machine ID').fill('laser-cutter-01')
  await page.getByLabel('Issue').fill(`Alert evidence ${tag()}`)
  await page.getByRole('button', { name: 'Start analysis' }).click()
  await expect(page).toHaveURL(/\/incidents\/[0-9a-f-]{36}$/)
  await expectStatus(page, 'awaiting_input')
  const alerts = page.getByRole('list', { name: 'Active alerts' })
  await expect(alerts).toContainText(MACHINE)
  await alerts.getByRole('link').first().click()
  await expect(page).toHaveURL(/\/alerts\//)
})
