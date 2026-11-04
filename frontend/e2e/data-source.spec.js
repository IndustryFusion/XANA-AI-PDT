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
import { openSignedIn, presetControls, AREAS } from './helpers'

test('on the mock source no request leaves the app origin', async ({ page, baseURL }) => {
  const foreign = []
  page.on('request', (req) => {
    const url = new URL(req.url())
    if (url.origin !== new URL(baseURL).origin && !url.protocol.startsWith('data')) foreign.push(req.url())
  })
  await openSignedIn(page, '/')
  for (const [path] of AREAS) await page.goto(path)
  await page.goto('/')
  await expect(page.getByRole('region', { name: 'System health' }).getByText('Overall: ok')).toBeVisible()
  expect(foreign).toEqual([])
})

test('a slow area shows its loading state', async ({ page }) => {
  await presetControls(page, { authEnabled: false, latencyMs: { system: 1500 } })
  await page.goto('/')
  const health = page.getByRole('region', { name: 'System health' })
  await expect(health.getByRole('status')).toHaveText('Loading…')
  await expect(health.getByText('Overall: ok')).toBeVisible({ timeout: 5000 })
})

test('a failing area shows its error state and the rest keeps working', async ({ page }) => {
  await presetControls(page, { authEnabled: false, failure: { entities: 'unavailable' } })
  await page.goto('/')
  await expect(page.getByRole('region', { name: 'Data overview' }).getByRole('alert')).toContainText('Could not load data overview')
  await expect(page.getByRole('region', { name: 'Active incidents' }).getByText('Needs input')).toBeVisible()
  await page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Alerts' }).click()
  await expect(page.getByRole('heading', { level: 1, name: 'Alerts' })).toBeVisible()
})

test('mock data controls are available in development', async ({ page }) => {
  await presetControls(page, { authEnabled: false })
  await page.goto('/')
  await page.getByRole('button', { name: 'Mock data controls' }).click()
  await expect(page.getByRole('dialog', { name: 'Mock data controls' })).toBeVisible()
})
