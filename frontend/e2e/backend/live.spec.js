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

// Live updates in the Data Explorer, against a real context broker and MQTT broker
// (the local environment with its `live` profile).
import { test, expect } from '@playwright/test'
import { presetControls } from '../helpers'

test.beforeEach(async ({ page }) => {
  await presetControls(page, { authEnabled: false })
})

test('a change in the broker reaches an open explorer with no reload', async ({ page }) => {
  const id = `urn:ngsi-ld:E2e:live-${Date.now().toString(36)}`
  const created = await page.request.post('/api/ngsi/import', { data: [{ id, type: 'E2e', note: { type: 'Property', value: 'before' } }] })
  expect(created.status()).toBe(200)
  try {
    await expect.poll(async () => (await (await page.request.get('/api/ngsi/subscription-health')).json()).status, { timeout: 30_000 }).toBe('ok')
    await page.goto(`/explorer/${encodeURIComponent(id)}?id=${encodeURIComponent(id)}`)
    const note = page.locator(`[data-entity="${id}"]`).first().locator('[data-attribute="note"]').first()
    await expect(note).toContainText('before')
    // Health says the backend is ready, not that this page's socket is open yet, and a change
    // before that isn't replayed. So the change is repeated until one arrives.
    await expect(async () => {
      const changed = await page.request.patch(`/api/ngsi/entities/${encodeURIComponent(id)}/attrs`, { data: { note: { value: 'after' } } })
      expect(changed.status()).toBe(204)
      await expect(note).toContainText('after', { timeout: 3000 })
    }).toPass({ timeout: 30_000 })
  } finally {
    await page.request.delete(`/api/ngsi/entities/${encodeURIComponent(id)}`)
  }
})
