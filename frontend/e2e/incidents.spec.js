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
import { E2E_SPEED, expectStatus, presetControls, sendAct, thread } from './helpers'

test.beforeEach(async ({ page }) => {
  await presetControls(page, { authEnabled: false, speed: E2E_SPEED })
})

/** Messages of a run as stored by the mock (what the source knows, whatever the screen shows). */
const storedMessages = (page, runId) => page.evaluate((id) => {
  const state = JSON.parse(sessionStorage.getItem('xana.mock.store.v1'))
  return state.runs.find((r) => r.runId === id).steps.filter((s) => s.node === 'message').map((s) => s.output.text)
}, runId)

async function toggleConnection(page, runId, action) {
  await page.getByRole('button', { name: 'Mock data controls' }).click()
  const dialog = page.getByRole('dialog', { name: 'Mock data controls' })
  await dialog.getByRole('button', { name: `${action} connection of ${runId}` }).click()
  await dialog.getByRole('button', { name: 'Done' }).click()
}

test('a lost connection shows reconnecting and recovers the current state, including replies meanwhile', async ({ page }) => {
  await page.goto('/incidents/run-1003')
  await expect(thread(page)).toContainText('Thank you. We are looking at Process chiller 01.')

  await toggleConnection(page, 'run-1003', 'Interrupt')
  await expect(page.getByRole('status').filter({ hasText: 'Connection lost. Reconnecting…' })).toBeVisible()

  await sendAct(page, 'Request', { text: 'Is a spare part needed?' })
  await expect.poll(() => storedMessages(page, 'run-1003')).toContainEqual(expect.stringContaining('remote session'))
  await expect(thread(page)).not.toContainText('remote session')

  await toggleConnection(page, 'run-1003', 'Restore')
  await expect(page.getByText('Connection lost. Reconnecting…')).toHaveCount(0)
  await expect(thread(page)).toContainText('May our technician open a remote session')
  await expect(thread(page).locator('li', { hasText: 'Is a spare part needed?' })).toContainText('Delivered')
  await expectStatus(page, 'awaiting_machine_builder')
})

test('reopening an incident from the history starts a run and continues its conversation', async ({ page }) => {
  await page.goto('/history')
  await page.getByRole('region', { name: 'Past incidents' }).getByRole('link', { name: /Extraction volume too low/ }).click()
  await expect(page).toHaveURL(/\/history\/35$/)
  await page.getByRole('button', { name: 'Reopen…' }).click()
  await page.getByRole('dialog', { name: 'Reopen incident #35?' }).getByRole('button', { name: 'Reopen' }).click()

  await expect(page).toHaveURL(/\/incidents\/run-\d+$/)
  await expect(page.getByRole('heading', { level: 2, name: 'Incident #35' })).toBeVisible()
  await expect(page.getByRole('region', { name: 'Open runs' }).getByRole('link', { name: /Extraction volume too low/ })).toHaveAttribute('aria-current', 'true')
  await expectStatus(page, 'awaiting_machine_builder')
  await expect(thread(page)).toContainText('service technician is on site')
  await expect(thread(page)).toContainText('Conversation reopened by the operator.')
  await expect(thread(page)).toContainText('What has changed since?')

  await page.goto('/history/35')
  await expect(page.getByText(/Reopened as run-\d+ in Active incidents/)).toBeVisible()
})

test('archived runs leave the active list and appear in the history', async ({ page }) => {
  await page.goto('/incidents/run-1004')
  await page.getByRole('button', { name: 'Confirm resolution' }).click()
  await expectStatus(page, 'completed')
  await page.getByRole('button', { name: 'Archive…' }).click()
  await page.getByRole('dialog', { name: 'Archive this run?' }).getByRole('button', { name: 'Archive' }).click()
  await expect(page).toHaveURL(/\/incidents$/)
  await expect(page.getByRole('region', { name: 'Open runs' }).getByRole('listitem')).toHaveCount(3)
  await page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Incident history' }).click()
  await page.getByRole('link', { name: /Uneven coating thickness/ }).click()
  await expect(page.getByRole('heading', { level: 2, name: 'Incident #44' })).toBeVisible()
  await page.goto('/incidents/run-1004')
  await expect(page.getByRole('heading', { name: 'This run is not active' })).toBeVisible()
})

test('dashboard to run: a listed incident opens its run view with the right panel', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('region', { name: 'Active incidents' }).getByRole('link', { name: /Coolant temperature above set point/ }).click()
  await expect(page).toHaveURL(/\/incidents\/run-1003$/)
  await expect(page.getByRole('heading', { level: 2, name: 'Incident #43' })).toBeVisible()
  await expect(page.getByRole('tab', { name: 'Conversation' })).toHaveAttribute('aria-selected', 'true')
  await expect(page.getByRole('region', { name: 'Waiting for CoolFlow Process Cooling' })).toBeVisible()
})

test('the scenario chosen in the mock data controls is followed by the next run', async ({ page }) => {
  await page.goto('/incidents?new=1')
  await page.getByRole('button', { name: 'Mock data controls' }).click()
  const dialog = page.getByRole('dialog', { name: 'Mock data controls' })
  await dialog.getByLabel('Scenario for the next started run').selectOption({ label: 'Failure' })
  await dialog.getByRole('button', { name: 'Done' }).click()
  await page.getByLabel('Machine ID').fill('deburring-01')
  await page.getByLabel('Issue').fill('Brush unit noise')
  await page.getByRole('button', { name: 'Start analysis' }).click()
  await expectStatus(page, 'failed')
})
