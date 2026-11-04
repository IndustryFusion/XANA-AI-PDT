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
import { escalate, expectStatus, panel, sendAct, startScenario, thread } from './helpers'

// One test per mock scenario: the UI drives the run from start to the
// scenario's documented end state at high playback speed.

test('happy path: confirm the resolution and the run completes', async ({ page }) => {
  await startScenario(page, 'happy_path', { machine: 'laser-cutter-02' })
  const confirm = panel(page, 'Confirm the proposed resolution')
  await expect(confirm).toContainText('Protective window contaminated by spatter')
  await expect(page.getByRole('region', { name: 'Decision' })).toContainText('86%')
  await confirm.getByRole('button', { name: 'Confirm resolution' }).click()
  await expectStatus(page, 'completed')
  await expect(panel(page, 'Completed')).toContainText(/The incident was logged as incident #\d+/)
})

test('low confidence: clarify, then confirm', async ({ page }) => {
  await startScenario(page, 'low_confidence', { machine: 'press-brake-02' })
  const ask = panel(page, 'The agent needs more information')
  await expect(ask).toContainText('Does the pressure drop on every bend')
  await expectStatus(page, 'awaiting_input')
  await ask.getByLabel('Your clarification').fill('Only on parts longer than 2 m.')
  await ask.getByRole('button', { name: 'Submit clarification' }).click()
  await expect(page.getByRole('region', { name: 'Agent steps' })).toContainText('Operator clarified: “Only on parts longer than 2 m.”')
  await panel(page, 'Confirm the proposed resolution').getByRole('button', { name: 'Confirm resolution' }).click()
  await expectStatus(page, 'completed')
})

test('rejected resolution: a new round lists the rejected proposal', async ({ page }) => {
  await startScenario(page, 'rejected_resolution', { machine: 'coating-01' })
  const first = panel(page, 'Confirm the proposed resolution')
  await expect(first).toContainText('Worn electrode in the left spray gun')
  await first.getByRole('button', { name: 'Reject…' }).click()
  await first.getByLabel('Reason for rejecting').fill('Electrode replaced yesterday.')
  await first.getByRole('button', { name: 'Submit rejection' }).click()
  const second = panel(page, 'Confirm the proposed resolution')
  await expect(second.getByRole('region', { name: 'Previously rejected resolutions' })).toContainText('Electrode replaced yesterday.')
  await expect(second).toContainText('Powder hose partly blocked')
  await second.getByRole('button', { name: 'Confirm resolution' }).click()
  await expectStatus(page, 'completed')
})

test('escalation within tier: data is shared automatically and the machine builder answers', async ({ page }) => {
  await startScenario(page, 'escalation_within_tier', { machine: 'chiller-01' })
  await escalate(page)
  await expect(page.getByRole('tab', { name: 'Conversation' })).toHaveAttribute('aria-selected', 'true')
  const policy = thread(page).locator('li', { hasText: 'Policy check' })
  await expect(policy).toContainText('were sent automatically')
  await expect(policy).toContainText('Coolant temperature and flow, last 24 h')
  await sendAct(page, 'Request', { text: 'Is a spare part needed?' })
  await expect(thread(page)).toContainText('May our technician open a remote session')
  await expect(thread(page).locator('li', { hasText: 'Is a spare part needed?' })).toContainText('Delivered')
  await expectStatus(page, 'awaiting_machine_builder')
})

test('request beyond tier: nothing beyond the tier is sent until the operator approves', async ({ page }) => {
  await startScenario(page, 'request_beyond_tier', { machine: 'laser-cutter-01' })
  await escalate(page)
  await expectStatus(page, 'awaiting_operator_approval')
  const approval = panel(page, 'Data request needs your approval')
  await expect(approval.getByRole('region', { name: 'Needs approval' })).toContainText('Laser source service log')
  const firstCheck = thread(page).locator('li', { hasText: 'Policy check' }).first()
  await expect(firstCheck).toContainText('wait for the operator’s approval')
  await expect(firstCheck.locator('dd').first()).not.toContainText('Laser source service log')
  await approval.getByRole('button', { name: 'Approve and send' }).click()
  await expectStatus(page, 'awaiting_machine_builder')
  await expect(thread(page).locator('li', { hasText: 'Approved by the operator and sent.' })).toContainText('Laser source service log')
  await expect(thread(page)).toContainText('It confirms our assessment')
})

test('machine-builder recommendation: answered as resolved', async ({ page }) => {
  await startScenario(page, 'mb_recommendation', { machine: 'deburring-01' })
  await escalate(page)
  await expectStatus(page, 'awaiting_recommendation_review')
  const review = panel(page, 'Recommendation from SurfaceTec Finishing')
  await expect(review.getByRole('listitem')).toHaveCount(4)
  await review.getByRole('button', { name: 'Resolved' }).click()
  await expectStatus(page, 'completed')
  await expect(panel(page, 'Completed')).toContainText('SurfaceTec Finishing')
})

test('machine builder closes: seen after a status check', async ({ page }) => {
  await startScenario(page, 'mb_closes', { machine: 'extractor-01' })
  await escalate(page)
  await expect(thread(page)).toContainText('service technician is on site')
  const closed = panel(page, 'Closed by the machine builder')
  await expect(async () => {
    await page.getByRole('button', { name: 'Check status' }).click()
    await expect(closed).toBeVisible({ timeout: 1000 })
  }).toPass()
  await expectStatus(page, 'mb_closed')
  await expect(closed).toContainText('Our technician replaced the worn part on site')
  await expect(closed.getByRole('button', { name: 'Reopen…' })).toBeVisible()
})

test('stop and reopen: the conversation continues', async ({ page }) => {
  await startScenario(page, 'stop_and_reopen', { machine: 'press-brake-01' })
  await escalate(page)
  await page.getByRole('button', { name: 'Stop run…' }).click()
  await page.getByRole('dialog', { name: 'Stop this run?' }).getByRole('button', { name: 'Stop run' }).click()
  await expectStatus(page, 'stopped')
  await panel(page, 'Stopped').getByRole('button', { name: 'Reopen…' }).click()
  await page.getByRole('dialog', { name: 'Reopen this run?' }).getByRole('button', { name: 'Reopen' }).click()
  await expectStatus(page, 'awaiting_machine_builder')
  await expect(thread(page)).toContainText('Conversation reopened by the operator.')
  await expect(thread(page)).toContainText('What has changed since?')
})

test('direct contact: close as escalated, not reopenable', async ({ page }) => {
  await startScenario(page, 'direct_contact', { machine: 'laser-cutter-01' })
  await escalate(page)
  await sendAct(page, 'Ask for direct contact')
  await expect(page.getByText('Direct contact requested by you')).toBeVisible()
  await sendAct(page, 'Close with outcome', { outcome: 'Escalated to direct contact' })
  await expectStatus(page, 'stopped')
  const stopped = panel(page, 'Stopped')
  await expect(stopped).toContainText('This run cannot be reopened.')
  await expect(stopped.getByRole('button', { name: 'Reopen…' })).toHaveCount(0)
})

test('failure: the run ends as failed with the error', async ({ page }) => {
  await startScenario(page, 'failure', { machine: 'coating-01' })
  await expectStatus(page, 'failed')
  const failed = panel(page, 'The run failed')
  await expect(failed).toContainText('The language model did not respond')
  await expect(failed.getByRole('button', { name: 'Archive…' })).toBeVisible()
  await expect(failed.getByRole('button', { name: 'Reopen…' })).toHaveCount(0)
})

test('degraded data: observe names the unavailable source and the run continues', async ({ page }) => {
  await startScenario(page, 'degraded_data', { machine: 'chiller-01' })
  const feed = page.getByRole('region', { name: 'Agent steps' })
  await expect(feed).toContainText('history unavailable, continuing with partial data')
  await feed.getByRole('button', { name: 'Show details of Observe step' }).click()
  const details = feed.getByRole('region', { name: 'Output of Observe step' })
  await expect(details.locator('li', { hasText: 'Time-series database' })).toContainText('unavailable')
  await panel(page, 'Confirm the proposed resolution').getByRole('button', { name: 'Confirm resolution' }).click()
  await expectStatus(page, 'completed')
})

test('a proposed resolution can be escalated to the machine builder instead of confirmed', async ({ page }) => {
  await startScenario(page, 'happy_path')
  await expectStatus(page, 'awaiting_confirmation')
  await expect(panel(page, 'Confirm the proposed resolution').getByRole('button', { name: 'Escalate to machine builder…' })).toBeVisible()
  await escalate(page)
  await expect(page.getByText(/^Escalated as ESC-/)).toBeVisible()
})
