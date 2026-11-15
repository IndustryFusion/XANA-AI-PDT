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
import { presetControls, setControls } from './helpers'

const SECRET = 'plant-north-secret'

test.beforeEach(async ({ page }) => {
  await presetControls(page, { authEnabled: false })
})

test('disconnect updates the header at once, then connect again with the credential', async ({ page }) => {
  await page.goto('/dataspace')
  const header = page.locator('.app-header')
  const connection = page.getByRole('region', { name: 'Dataspace gateway' })
  await expect(header.getByText('Dataspace connected')).toBeVisible()
  await expect(page.getByRole('region', { name: 'Compatible peers' })).toBeVisible()

  await connection.getByRole('button', { name: 'Disconnect…' }).click()
  await page.getByRole('dialog', { name: 'Disconnect from the dataspace?' }).getByRole('button', { name: 'Disconnect' }).click()
  await expect(connection.getByText('Dataspace disconnected')).toBeVisible()
  await expect(header.getByText('Dataspace disconnected')).toBeVisible()
  await expect(page.getByRole('region', { name: 'Compatible peers' })).toHaveCount(0)

  await connection.getByLabel('Dataspace credential').fill('not-the-secret')
  await connection.getByRole('button', { name: 'Connect' }).click()
  await expect(connection.getByRole('alert')).toHaveText('The dataspace refused the client or its secret. Check the secret, and that the client is registered in the dataspace.')

  await connection.getByLabel('Dataspace credential').fill(SECRET)
  await connection.getByRole('button', { name: 'Connect' }).click()
  await expect(connection.getByText('Dataspace connected')).toBeVisible()
  await expect(header.getByText('Dataspace connected')).toBeVisible()
  await expect(page.getByRole('region', { name: 'Compatible peers' }).getByRole('link', { name: /Formwerk/ })).toBeVisible()

  await page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Dashboard' }).click()
  await expect(page.getByRole('region', { name: 'Dataspace' }).getByText('4', { exact: true })).toBeVisible()
})

test('approving a capability request grants the capability to the peer', async ({ page }) => {
  await page.goto('/dataspace?peer=peer-formwerk')
  const here = page.getByRole('table', { name: 'What Formwerk Press Technology may access here' })
  const history = here.locator('tr[data-capability="twin:history"]')
  await expect(history.getByText('Denied')).toBeVisible()

  const requests = page.getByRole('region', { name: 'Capability requests' })
  await requests.getByRole('button', { name: 'Approve request req-005 of Formwerk Press Technology' }).click()
  const dialog = page.getByRole('dialog', { name: 'Approve request req-005' })
  await dialog.getByLabel('Note (optional)').fill('For the service visit next week.')
  await dialog.getByRole('button', { name: 'Approve' }).click()
  await expect(dialog).toHaveCount(0)
  const row = requests.locator('tr[data-request="req-005"]')
  await expect(row.getByText('Approved')).toBeVisible()
  await expect(row.getByText('For the service visit next week.')).toBeVisible()
  await expect(history.getByText('Approved')).toBeVisible()

  await page.reload()
  await expect(history.getByText('Approved')).toBeVisible()
})

test('a capability is denied for a peer after confirmation', async ({ page }) => {
  await page.goto('/dataspace')
  await page.getByRole('region', { name: 'Compatible peers' }).getByRole('link', { name: /SurfaceTec Finishing/ }).click()
  await expect(page).toHaveURL(/\?peer=peer-surfacetec$/)
  await page.getByRole('button', { name: 'Deny Machine twin for SurfaceTec Finishing' }).click()
  await page.getByRole('dialog', { name: 'Deny: Machine twin for SurfaceTec Finishing' }).getByRole('button', { name: 'Deny' }).click()
  await expect(page.getByRole('table', { name: 'What SurfaceTec Finishing may access here' }).locator('tr[data-capability="twin:direct"]').getByText('Denied')).toBeVisible()
})

test('the gateway being unreachable is reported distinctly', async ({ page }) => {
  await page.goto('/dataspace')
  await setControls(page, { connection: 'disconnected', gatewayReachable: false })
  await page.reload()
  const connection = page.getByRole('region', { name: 'Dataspace gateway' })
  await connection.getByLabel('Dataspace credential').fill(SECRET)
  await connection.getByRole('button', { name: 'Connect' }).click()
  await expect(connection.getByRole('alert')).toContainText('The dataspace gateway can’t be reached. Check the gateway in the System area or try again later.')
})
