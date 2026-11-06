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

// The UI on the backend data source against a running backend with the scripted
// language model and the sample data (see playwright.config.js, `backend` project).
// Scripted runs ask one question first and propose a diagnosis after a clarification.
import { test, expect } from '@playwright/test'
import { expectStatus, presetControls } from '../helpers'

const MACHINE = 'laser-cutter-01'

test.beforeEach(async ({ page }) => {
  await presetControls(page, { authEnabled: false })
})

const steps = (page) => page.getByRole('region', { name: 'Agent steps' })
const stepNodes = (scope) => scope.locator('[data-node]').evaluateAll((items) => items.map((i) => i.dataset.node))

/** Starts an incident from the new-incident form and waits for its run view. */
async function startIncident(page, issue) {
  await page.goto('/incidents?new=1')
  await page.getByLabel('Machine ID').fill(MACHINE)
  await page.getByLabel('Issue').fill(issue)
  await page.getByRole('button', { name: 'Start analysis' }).click()
  await expect(page).toHaveURL(/\/incidents\/[0-9a-f-]{36}$/)
  return new URL(page.url()).pathname.split('/').pop()
}

async function clarify(page, text) {
  await expectStatus(page, 'awaiting_input')
  await page.getByLabel('Your clarification').fill(text)
  await page.getByRole('button', { name: 'Submit clarification' }).click()
  await expectStatus(page, 'awaiting_confirmation')
}

const unique = (text) => `${text} (${Date.now().toString(36)})`

test('start → steps → clarify → confirm → archive → history with the full trace', async ({ page }) => {
  const issue = unique('Cut edges show burrs')
  await startIncident(page, issue)

  await expectStatus(page, 'awaiting_input')
  await expect.poll(() => stepNodes(steps(page))).toEqual(['observe', 'hypothesize', 'validate', 'decide'])
  await expect(steps(page).locator('[data-node="observe"]')).toContainText('Read Laser cutter 01')
  await expect(page.getByRole('heading', { name: 'The agent needs more information' })).toBeVisible()

  await clarify(page, 'The nozzle was changed this morning.')
  await expect(steps(page)).toContainText('Operator clarified: “The nozzle was changed this morning.”')
  const proposal = page.getByRole('region', { name: 'Confirm the proposed resolution' })
  await expect(proposal).toContainText('Wear of a moving component')

  await page.getByRole('button', { name: 'Confirm resolution' }).click()
  await expectStatus(page, 'completed')
  await expect(steps(page).locator('[data-node="act"]')).toContainText('Incident logged with the confirmed resolution')

  await page.getByRole('button', { name: 'Archive…' }).click()
  await page.getByRole('dialog', { name: 'Archive this run?' }).getByRole('button', { name: 'Archive' }).click()
  await expect(page).toHaveURL(/\/incidents$/)
  await expect(page.getByRole('region', { name: 'Open runs' })).not.toContainText(issue)

  await page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Incident history' }).click()
  await page.getByRole('region', { name: 'Past incidents' }).getByRole('link', { name: new RegExp(issue.replace(/[()]/g, '\\$&')) }).click()
  const trace = page.getByRole('region', { name: 'Agent trace' })
  await expect.poll(() => stepNodes(trace)).toEqual([
    'observe', 'hypothesize', 'validate', 'decide', 'clarification',
    'observe', 'hypothesize', 'validate', 'decide', 'resolution', 'act',
  ])
  await expect(page.getByRole('region', { name: 'Summary' })).toContainText('Wear of a moving component')
})

test('a rejected resolution is not proposed again and is listed with its reason', async ({ page }) => {
  await startIncident(page, unique('Cut quality dropped'))
  await clarify(page, 'Only on stainless steel.')
  const proposal = page.getByRole('region', { name: 'Confirm the proposed resolution' })
  await expect(proposal).toContainText('Wear of a moving component')

  await page.getByRole('button', { name: 'Reject…' }).click()
  await page.getByLabel('Reason for rejecting').fill('The axis bearings were replaced last week.')
  await page.getByRole('button', { name: 'Submit rejection' }).click()

  await expect(steps(page)).toContainText('Operator rejected “Wear of a moving component”: The axis bearings were replaced last week.')
  await expect.poll(() => stepNodes(steps(page)).then((nodes) => nodes.filter((n) => n === 'decide').length)).toBe(3)
  await expectStatus(page, 'awaiting_confirmation')
  await expect(proposal).toContainText('Cooling or supply problem')
  const rejected = proposal.getByRole('region', { name: 'Previously rejected resolutions' })
  await expect(rejected).toContainText('Wear of a moving component')
  await expect(rejected).toContainText('The axis bearings were replaced last week.')
})

test('escalation is not offered: the dialog gives the backend reason', async ({ page }) => {
  await startIncident(page, unique('Gas pressure warning'))
  await expectStatus(page, 'awaiting_input')
  await page.getByRole('button', { name: 'Escalate to machine builder…' }).click()
  const dialog = page.getByRole('dialog', { name: 'Escalate to the machine builder' })
  await expect(dialog).toContainText('Escalation is not possible.')
  await expect(dialog).toContainText('Escalation to the machine builder is not available in this version.')
  await expect(dialog.getByRole('button', { name: 'Escalate', exact: true })).toHaveCount(0)
  await dialog.getByRole('button', { name: 'Close', exact: true }).click()
  await expect(dialog).toHaveCount(0)
  await expectStatus(page, 'awaiting_input')
})

test('a run archived elsewhere shows that it is no longer active', async ({ page }) => {
  const runId = await startIncident(page, unique('Fan noise'))
  await expectStatus(page, 'awaiting_input')
  expect((await page.request.post(`/api/agent/stop/${runId}`, { data: {} })).status()).toBe(200)
  await expectStatus(page, 'stopped')
  expect((await page.request.post(`/api/agent/archive/${runId}`)).status()).toBe(204)
  await expect(page.getByRole('heading', { name: 'This run is not active' })).toBeVisible()
})

test('a stopped backend affects only its areas: active incidents and the explorer show errors, alerts still work', async ({ page }) => {
  await page.route('**/api/**', (route) => route.abort('connectionrefused'))
  await page.goto('/incidents')
  const error = page.getByRole('alert').filter({ hasText: 'Could not load open runs' })
  await expect(error).toContainText('The backend cannot be reached.')
  await expect(error.getByRole('button', { name: 'Retry' })).toBeVisible()

  await page.goto('/explorer')
  await expect(page.getByRole('alert').filter({ hasText: 'Could not load entity types' })).toContainText('The backend cannot be reached.')

  await page.goto('/alerts')
  await expect(page.getByRole('table')).toBeVisible()

  await page.unroute('**/api/**')
  await page.goto('/incidents')
  await expect(page.getByRole('alert').filter({ hasText: 'Could not load open runs' })).toHaveCount(0)
})

test('system health shows the backend checks', async ({ page }) => {
  await page.goto('/system')
  const health = page.getByRole('table', { name: 'Dependencies and their health' })
  for (const check of ['Memory database', 'Time-series store', 'Context broker', 'Language model']) await expect(health).toContainText(check)
  await expect(health).toContainText('Scripted answers, no model')
})
