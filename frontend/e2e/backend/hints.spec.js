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

// Value hints in the Data Explorer, from a real Fuseki with the sample shapes and knowledge
// (the local environment with its `ontology` profile).
import { test, expect } from '@playwright/test'
import { presetControls } from '../helpers'

const MACHINE = 'urn:ngsi-ld:Machine:laser-cutter-01'
const SENSOR = 'urn:ngsi-ld:Sensor:laser-cutter-01-temperature'

test.beforeEach(async ({ page }) => {
  await presetControls(page, { authEnabled: false })
})

async function edit(page, id, name) {
  await page.goto(`/explorer/${encodeURIComponent(id)}?id=${encodeURIComponent(id)}`)
  const line = page.locator(`[data-entity="${id}"]`).first().locator(`[data-attribute="${name}"]`).first()
  await line.locator('.attr-line__value-btn').first().click()
  return page.getByRole('group', { name: `Edit ${name}` })
}

test('the editor offers allowed values from the shapes', async ({ page }) => {
  const editor = await edit(page, MACHINE, 'status')
  await expect(editor.getByRole('listbox', { name: 'Suggested values' })).toContainText('maintenance')
})

test('the editor shows an allowed range', async ({ page }) => {
  const editor = await edit(page, SENSOR, 'value')
  await expect(editor).toContainText('Allowed: from -40, below 1000')
})

test('without hints the editor still works', async ({ page }) => {
  await page.route('**/api/shacl/hints**', (route) => route.fulfill({ json: { hint_type: 'none', values: [], minimum: null, maximum: null, minimum_exclusive: false, maximum_exclusive: false, datatype: null, detail: 'The ontology service cannot be reached (ConnectError).' } }))
  const editor = await edit(page, MACHINE, 'status')
  await expect(editor.getByRole('combobox')).toBeVisible()
  await expect(editor.getByRole('alert')).toHaveCount(0)
  await expect(editor.getByRole('listbox')).toHaveCount(0)
  await expect(editor).toContainText('No suggestions: The ontology service cannot be reached')
})
