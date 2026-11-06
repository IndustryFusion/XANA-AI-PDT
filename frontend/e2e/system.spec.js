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
import { E2E_SPEED, presetControls } from './helpers'

test.beforeEach(async ({ page }) => {
  await presetControls(page, { authEnabled: false, speed: E2E_SPEED })
})

test('a changed service address is used by the next health check, and can be reset', async ({ page }) => {
  await page.goto('/system')
  const health = page.getByRole('region', { name: 'Dependency health' })
  const broker = health.locator('tr[data-check="message-broker"]')
  await expect(broker).toContainText('Reached at mqtt://message-broker.example.org:1883')

  const settings = page.getByRole('region', { name: 'Service settings' })
  await settings.getByLabel('Message broker', { exact: true }).fill('not an address')
  await settings.getByRole('button', { name: 'Save settings' }).click()
  await expect(settings.getByLabel('Message broker', { exact: true })).toHaveAttribute('aria-invalid', 'true')
  await expect(broker).toContainText('message-broker.example.org')

  await settings.getByLabel('Message broker', { exact: true }).fill('mqtt://broker.invalid:1883')
  await settings.getByRole('button', { name: 'Save settings' }).click()
  await expect(settings.locator('[data-setting="messageBroker"]').getByText('Changed')).toBeVisible()
  await expect(broker).toContainText('No response from mqtt://broker.invalid:1883.')
  await expect(broker.getByText('Error')).toBeVisible()
  await expect(health.getByText('Overall health: Degraded')).toBeVisible()

  await page.reload()
  await expect(broker).toContainText('mqtt://broker.invalid:1883')
  await settings.getByRole('button', { name: 'Reset to deployment value: Message broker' }).click()
  await expect(settings.getByLabel('Message broker', { exact: true })).toHaveValue('mqtt://message-broker.example.org:1883')
  await expect(broker).toContainText('Reached at mqtt://message-broker.example.org:1883')
  await expect(health.getByText('Overall health: OK')).toBeVisible()
})

test('check again updates the time of the check', async ({ page }) => {
  await page.goto('/system')
  const health = page.getByRole('region', { name: 'Dependency health' })
  const time = health.locator('time')
  await expect(time).toHaveAttribute('datetime', /.+/)
  const first = await time.getAttribute('datetime')
  await expect(async () => {
    await health.getByRole('button', { name: 'Check again' }).click()
    expect(await time.getAttribute('datetime')).not.toBe(first)
  }).toPass()
})

const knowledgeBaseOn = process.env.VITE_KNOWLEDGE_BASE === 'on'

test('the knowledge base is not shown by default', async ({ page }) => {
  test.skip(knowledgeBaseOn, 'The knowledge base is turned on.')
  await page.goto('/system')
  await expect(page.getByRole('button', { name: 'Check again' })).toBeVisible()
  await expect(page.getByRole('region', { name: 'Knowledge base' })).toHaveCount(0)
  await expect(page.getByText('Knowledge base')).toHaveCount(0)
})

test('an uploaded document is ingested and found by a test query', async ({ page }) => {
  test.skip(!knowledgeBaseOn, 'The knowledge base is off by default.')
  await page.goto('/system')
  const kb = page.getByRole('region', { name: 'Knowledge base' })
  await kb.getByRole('radio', { name: /Structured pipeline/ }).check()
  await expect(kb.getByRole('table', { name: 'Documents in the structured pipeline' })).toBeVisible()
  await kb.getByLabel('Or choose files').setInputFiles({
    name: 'Back gauge calibration.md',
    mimeType: 'text/markdown',
    buffer: Buffer.from('# Calibration\nMeasure the reference block with the calliper and enter the offset in menu B-12.\n# Lubrication\nGrease the ball screw every 500 hours.'),
  })
  const row = kb.locator('tr[data-document="Back gauge calibration.md"]')
  await expect(row).toBeVisible()
  await expect(row.getByText('Done')).toBeVisible()
  await expect(row.getByRole('cell', { name: '2', exact: true })).toBeVisible()

  await kb.getByLabel('Question').fill('calliper offset reference block')
  await kb.getByRole('button', { name: 'Run test query' }).click()
  const first = kb.getByRole('list', { name: 'Retrieved passages' }).getByRole('listitem').first()
  await expect(first).toContainText('Back gauge calibration.md')
  await expect(first).toContainText('section Calibration')
  await expect(first).toContainText('Score 1.00')
})

test('a corrupt document fails with the reason and is removed', async ({ page }) => {
  test.skip(!knowledgeBaseOn, 'The knowledge base is off by default.')
  await page.goto('/system')
  const kb = page.getByRole('region', { name: 'Knowledge base' })
  await kb.getByLabel('Or choose files').setInputFiles({ name: 'corrupt-scan.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4') })
  const row = kb.locator('tr[data-document="corrupt-scan.pdf"]')
  await expect(row.getByText('Failed')).toBeVisible()
  await expect(row).toContainText('could not be parsed')
  await row.getByRole('button', { name: 'Delete corrupt-scan.pdf' }).click()
  await page.getByRole('dialog', { name: 'Delete corrupt-scan.pdf?' }).getByRole('button', { name: 'Delete' }).click()
  await expect(row).toHaveCount(0)
})
