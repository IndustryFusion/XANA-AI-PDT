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
import { execSync } from 'node:child_process'
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

async function created(page, tag, attributes) {
  const id = `urn:ngsi-ld:E2e:${tag}-${Date.now().toString(36)}`
  expect((await page.request.post('/api/ngsi/import', { data: [{ id, type: 'E2e', ...attributes }] })).status()).toBe(200)
  await expect.poll(async () => (await (await page.request.get('/api/ngsi/subscription-health')).json()).status, { timeout: 30_000 }).toBe('ok')
  await page.goto(`/explorer/${encodeURIComponent(id)}?id=${encodeURIComponent(id)}`)
  return id
}

const set = (page, id, attribute, value) => page.request.patch(`/api/ngsi/entities/${encodeURIComponent(id)}/attrs`, { data: { [attribute]: { value } } })

test('only the attribute that changed is highlighted, though the broker sends the whole entity', async ({ page }) => {
  const id = await created(page, 'one', { note: { type: 'Property', value: 'before' }, other: { type: 'Property', value: 'same' } })
  const entity = page.locator(`[data-entity="${id}"]`).first()
  try {
    await expect(async () => {
      await set(page, id, 'note', `after ${Date.now()}`)
      await expect(entity.locator('[data-attribute="note"] .attr-line--changed').first()).toBeVisible({ timeout: 1500 })
    }).toPass({ timeout: 30_000 })
    await expect(entity.locator('[data-attribute="other"] .attr-line--changed')).toHaveCount(0)
  } finally {
    await page.request.delete(`/api/ngsi/entities/${encodeURIComponent(id)}`)
  }
})

const CONTAINER = process.env.XANA_E2E_MQTT_CONTAINER

test('a change during an outage shows once updates are back, with no reload', async ({ page }) => {
  test.skip(!CONTAINER, 'needs XANA_E2E_MQTT_CONTAINER')
  test.setTimeout(150_000)
  const id = await created(page, 'gap', { note: { type: 'Property', value: 'v0' } })
  const note = page.locator(`[data-entity="${id}"]`).first().locator('[data-attribute="note"]').first()
  await expect(note).toContainText('v0')
  try {
    execSync(`docker stop ${CONTAINER}`)
    await expect(page.locator('.explorer__tools')).toContainText(/unavailable/i, { timeout: 30_000 })
    await set(page, id, 'note', 'during the outage')
  } finally {
    execSync(`docker start ${CONTAINER}`)
  }
  await expect(page.locator('.explorer__tools')).not.toContainText(/unavailable/i, { timeout: 60_000 })
  await expect(note).toContainText('during the outage', { timeout: 30_000 })
  await page.request.delete(`/api/ngsi/entities/${encodeURIComponent(id)}`)
})

test('the UI opens the stream through the development server, which keeps the page origin', async ({ page }) => {
  await page.goto('/explorer')
  const answer = await page.evaluate(async () => {
    const own = await new Promise((resolve) => {
      const socket = new WebSocket(`ws://${location.host}/api/ngsi/ws`)
      socket.onopen = () => { socket.close(); resolve('open') }
      socket.onerror = () => resolve('refused')
    })
    return own
  })
  expect(answer).toBe('open')
})
