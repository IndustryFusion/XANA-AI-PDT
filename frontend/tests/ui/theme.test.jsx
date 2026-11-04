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

import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ThemeProvider, ThemeSelect } from '../../src/ui/theme'

afterEach(() => document.documentElement.removeAttribute('data-theme'))

function renderSelect() {
  return render(
    <ThemeProvider>
      <ThemeSelect />
    </ThemeProvider>,
  )
}

test('follows the system preference when the operator has not chosen', () => {
  renderSelect()
  expect(document.documentElement).not.toHaveAttribute('data-theme')
  expect(screen.getByLabelText('Theme')).toHaveValue('system')
})

test('applies the chosen theme immediately and persists it', async () => {
  renderSelect()
  await userEvent.selectOptions(screen.getByLabelText('Theme'), 'light')
  expect(document.documentElement).toHaveAttribute('data-theme', 'light')
  expect(localStorage.getItem('xana.theme')).toBe('light')
})

test('restores the persisted choice after a reload', () => {
  localStorage.setItem('xana.theme', 'dark')
  renderSelect()
  expect(document.documentElement).toHaveAttribute('data-theme', 'dark')
  expect(screen.getByLabelText('Theme')).toHaveValue('dark')
})

test('going back to system removes the override', async () => {
  localStorage.setItem('xana.theme', 'light')
  renderSelect()
  await userEvent.selectOptions(screen.getByLabelText('Theme'), 'system')
  expect(document.documentElement).not.toHaveAttribute('data-theme')
  expect(localStorage.getItem('xana.theme')).toBeNull()
})
