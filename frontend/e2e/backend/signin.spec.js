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

// Sign-in against a real identity provider. Needs a backend with sign-in on, so it runs only
// when asked: XANA_E2E_SIGNIN=1, with the local environment started with the `auth` profile.
import { expect, test } from '@playwright/test'

test.skip(!process.env.XANA_E2E_SIGNIN, 'Set XANA_E2E_SIGNIN=1 with a backend that has sign-in on')

test.describe.configure({ mode: 'serial' })

test('wrong password stays on the sign-in screen with its message', async ({ page }) => {
  await page.goto('/system')
  await page.getByLabel('Username').fill('operator')
  await page.getByLabel('Password').fill('wrong')
  await page.getByRole('button', { name: 'Sign in' }).click()
  await expect(page.getByRole('alert')).toHaveText('Username or password is not correct.')
})

test('sign in opens the requested screen with the user, token time and factory; sign out returns', async ({ page }) => {
  await page.goto('/system')
  await expect(page.getByText('Sign in with Keycloak')).toBeVisible()
  await expect(page.getByText(/Mock data/)).toHaveCount(0)
  await page.getByLabel('Username').fill('operator')
  await page.getByLabel('Password').fill('operator')
  await page.getByRole('button', { name: 'Sign in' }).click()
  const session = page.getByRole('region', { name: 'Session' })
  await expect(session.getByText('Sample Operator')).toBeVisible()
  await expect(session.getByText('Active')).toBeVisible()
  await expect(session.getByTestId('token-countdown')).toHaveText(/[0-5]:\d\d left/)
  await page.reload()
  await expect(session.getByText('Active')).toBeVisible()
  await page.getByRole('button', { name: /account and factory details/ }).click()
  await page.getByRole('button', { name: 'Sign out' }).click()
  await expect(page.getByRole('button', { name: 'Sign in' })).toBeVisible()
})
