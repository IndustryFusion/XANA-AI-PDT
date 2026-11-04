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
import { openSignedIn, presetControls, setControls, signIn } from './helpers'

test('without a session the sign-in screen is shown', async ({ page }) => {
  await page.goto('/alerts')
  await expect(page.getByLabel('Username')).toBeVisible()
  await expect(page.getByText('Sign in with Mock identity provider')).toBeVisible()
  await expect(page.getByRole('navigation', { name: 'Main' })).toHaveCount(0)
})

test('signing in opens the requested screen', async ({ page }) => {
  await page.goto('/alerts')
  await signIn(page)
  await expect(page.getByRole('heading', { level: 1, name: 'Alerts' })).toBeVisible()
  await expect(page).toHaveURL(/\/alerts$/)
})

test('wrong credentials and an unreachable provider give different messages', async ({ page }) => {
  await page.goto('/')
  await signIn(page, { password: 'wrong' })
  await expect(page.getByRole('alert')).toHaveText('Username or password is not correct.')

  await setControls(page, { failure: { session: 'unavailable' } })
  await signIn(page)
  await expect(page.getByRole('alert')).toContainText('could not be reached')
  await expect(page.getByLabel('Username')).toBeVisible()
})

test('with authentication disabled the application opens directly', async ({ page }) => {
  await presetControls(page, { authEnabled: false })
  await page.goto('/')
  await expect(page.getByRole('heading', { level: 1, name: 'Dashboard' })).toBeVisible()
})

test('an expired session returns to sign-in and back to the same screen', async ({ page }) => {
  await openSignedIn(page, '/dataspace')
  await expect(page.getByRole('heading', { level: 1, name: 'Dataspace' })).toBeVisible()
  await setControls(page, { sessionRevision: 1 })
  await expect(page.getByLabel('Username')).toBeVisible({ timeout: 5000 })
  await signIn(page)
  await expect(page.getByRole('heading', { level: 1, name: 'Dataspace' })).toBeVisible()
  await expect(page).toHaveURL(/\/dataspace$/)
})

test('sign-out ends the session', async ({ page }) => {
  await openSignedIn(page)
  await page.getByRole('button', { name: /account and factory details/ }).click()
  await page.getByRole('button', { name: 'Sign out' }).click()
  await expect(page.getByLabel('Username')).toBeVisible()
  await page.reload()
  await expect(page.getByLabel('Username')).toBeVisible()
})
