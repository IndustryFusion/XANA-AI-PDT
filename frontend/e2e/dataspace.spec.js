import { test, expect } from '@playwright/test'
import { presetControls, setControls } from './helpers'

const SECRET = 'plant-north-secret'

test.beforeEach(async ({ page }) => {
  await presetControls(page, { authEnabled: false })
})

test('disconnect updates the header at once, then connect again with the credential', async ({ page }) => {
  await page.goto('/dataspace')
  const header = page.locator('.app-header')
  const connection = page.getByRole('region', { name: 'Connection' })
  await expect(header.getByText('Dataspace connected')).toBeVisible()
  await expect(page.getByRole('region', { name: 'Compatible peers' })).toBeVisible()

  await connection.getByRole('button', { name: 'Disconnect…' }).click()
  await page.getByRole('dialog', { name: 'Disconnect from the dataspace?' }).getByRole('button', { name: 'Disconnect' }).click()
  await expect(connection.getByText('Dataspace disconnected')).toBeVisible()
  await expect(header.getByText('Dataspace disconnected')).toBeVisible()
  await expect(page.getByRole('region', { name: 'Compatible peers' })).toHaveCount(0)

  await connection.getByLabel('Dataspace credential').fill('not-the-secret')
  await connection.getByRole('button', { name: 'Connect' }).click()
  await expect(connection.getByRole('alert')).toHaveText('The dataspace rejected the credential. Check it and try again.')

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
  await expect(history.getByText('Granted')).toBeVisible()

  await page.reload()
  await expect(history.getByText('Granted')).toBeVisible()
})

test('a capability is denied for a peer after confirmation', async ({ page }) => {
  await page.goto('/dataspace')
  await page.getByRole('region', { name: 'Compatible peers' }).getByRole('link', { name: /SurfaceTec Finishing/ }).click()
  await expect(page).toHaveURL(/\?peer=peer-surfacetec$/)
  await page.getByRole('button', { name: 'Deny Machine entity for SurfaceTec Finishing' }).click()
  await page.getByRole('dialog', { name: 'Deny: Machine entity for SurfaceTec Finishing' }).getByRole('button', { name: 'Deny' }).click()
  await expect(page.getByRole('table', { name: 'What SurfaceTec Finishing may access here' }).locator('tr[data-capability="twin:direct"]').getByText('Denied')).toBeVisible()
})

test('the gateway being unreachable is reported distinctly', async ({ page }) => {
  await page.goto('/dataspace')
  await setControls(page, { connection: 'disconnected', gatewayReachable: false })
  await page.reload()
  const connection = page.getByRole('region', { name: 'Connection' })
  await connection.getByLabel('Dataspace credential').fill(SECRET)
  await connection.getByRole('button', { name: 'Connect' }).click()
  await expect(connection.getByRole('alert')).toContainText('The dataspace gateway cannot be reached.')
})
