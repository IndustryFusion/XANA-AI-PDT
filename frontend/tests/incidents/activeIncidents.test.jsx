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

import { render, screen, waitFor, within } from '@testing-library/react'
import App from '../../src/App'
import userEvent from '@testing-library/user-event'
import { store } from '../../src/data/sources/mock'
import { writeControls } from '../../src/data/sources/mock/controls'
import { paths } from '../../src/app/router'
import { renderApp, resetMock } from '../helpers'

const controls = { authEnabled: false, speed: 50 }
const open = (path) => renderApp({ path, controls })
const list = () => screen.findByRole('region', { name: 'Open runs' })
const items = async () => within(await list()).findAllByRole('listitem')

describe('open runs list', () => {
  test('lists every open run with issue, machine, status label and age, newest first', async () => {
    open('/incidents')
    const rows = await items()
    expect(rows).toHaveLength(4)
    expect(rows[0]).toHaveTextContent('burr formation')
    expect(rows[0]).toHaveTextContent('laser-cutter-01')
    expect(rows[0]).toHaveTextContent('4 min')
    expect(within(rows[1]).getByText('Needs input')).toBeVisible()
    expect(rows[1]).toHaveTextContent('#42')
    expect(rows[3]).toHaveTextContent('3 h 10 min')
  })

  test('each run is colour-coded by its status, and runs in progress or waiting for input pulse', async () => {
    open('/incidents')
    const rows = await items()
    expect(rows[0]).toHaveClass('toned--progress')
    expect(rows[1]).toHaveClass('toned--attention')
    expect(within(rows[1]).getByText('Needs input')).toHaveClass('badge--pulse')
    expect(within(rows[3]).getByText('Awaiting machine builder')).not.toHaveClass('badge--pulse')
  })

  test('a run from a machine event or an alert says so, and an operator\'s adds nothing', async () => {
    resetMock({ path: '/incidents', controls })
    store.update((s) => { s.runs[0].source = 'ngsi'; s.runs[1].source = 'alert'; return s })
    render(<App />)
    const rows = await items()
    expect(within(rows[0]).getByTestId('run-source')).toHaveTextContent('Machine event')
    expect(within(rows[1]).getByTestId('run-source')).toHaveTextContent('Alert')
    expect(within(rows[2]).queryByTestId('run-source')).toBeNull()
    await userEvent.setup().click(within(rows[0]).getByRole('link'))
    const details = await screen.findAllByTestId('run-source')
    expect(details.map((d) => d.textContent)).toContain('Machine event')
  })

  test('no open runs: an empty state offers to start a new analysis', async () => {
    const user = userEvent.setup()
    resetMock({ path: '/incidents', controls })
    store.update((s) => { s.runs = []; return s })
    render(<App />)
    const region = await list()
    expect(await within(region).findByText('No open runs.')).toBeVisible()
    await user.click(within(region).getByRole('link', { name: 'Start a new analysis' }))
    expect(await screen.findByRole('region', { name: 'New incident' })).toBeVisible()
  })

  test('selecting a run shows it, marks it and puts it in the URL', async () => {
    const user = userEvent.setup()
    open('/incidents')
    const region = await list()
    await user.click(await within(region).findByRole('link', { name: /Hydraulic pressure drops/ }))
    expect(window.location.pathname).toBe(paths.run('run-1002'))
    expect(within(region).getByRole('link', { name: /Hydraulic pressure drops/ })).toHaveAttribute('aria-current', 'true')
    expect(await screen.findByRole('heading', { name: 'Incident #42', level: 2 })).toBeVisible()
  })

  test('the list stays current when the selected run changes state', async () => {
    const user = userEvent.setup()
    open(paths.run('run-1004'))
    await user.click(await screen.findByRole('button', { name: 'Confirm resolution' }))
    const row = (await items()).find((li) => li.textContent.includes('Uneven coating'))
    await waitFor(() => expect(within(row).getByText('Completed')).toBeVisible())
  })

  test('an unknown or archived run says it is not active and links to the history', async () => {
    open(paths.run('run-9999'))
    expect(await screen.findByRole('heading', { name: 'This run is not active' })).toBeVisible()
    expect(screen.getByRole('link', { name: 'Look for it in the incident history' })).toHaveAttribute('href', '/history')
  })

  test('filter by machine from the URL names the filter and can be cleared', async () => {
    const user = userEvent.setup()
    open(paths.activeIncidentsFor('urn:ngsi-ld:Machine:press-brake-02'))
    const region = await list()
    await waitFor(() => expect(within(region).getAllByRole('link', { name: /pressure|burr|coating|Coolant/ })).toHaveLength(1))
    expect(within(region).getByText('Machine:')).toBeVisible()
    await user.click(within(region).getByRole('link', { name: 'Clear filter' }))
    expect(window.location.search).toBe('')
    expect(await items()).toHaveLength(4)
  })
})

describe('new incident form', () => {
  test('starts a run: it appears in the list, its view opens and steps stream in', async () => {
    const user = userEvent.setup()
    open(paths.newIncident())
    await user.type(await screen.findByLabelText('Machine ID'), 'press-brake-01')
    await user.type(screen.getByLabelText('Issue'), 'Back gauge noise during positioning')
    await user.click(screen.getByRole('button', { name: 'Start analysis' }))
    await waitFor(() => expect(window.location.pathname).toBe(paths.run('run-1005')))
    expect(await screen.findByText('Back gauge noise during positioning', { selector: '.run-header__issue' })).toBeVisible()
    expect(await screen.findByRole('link', { name: /Back gauge noise/ })).toBeVisible()
    const feed = await screen.findByRole('region', { name: 'Agent steps' })
    expect(await within(feed).findByText('Observe')).toBeVisible()
  })

  test('prefilled from an entity reference with focus in the issue field', async () => {
    open(paths.newIncident('urn:ngsi-ld:Machine:chiller-01'))
    expect(await screen.findByLabelText('Machine ID')).toHaveValue('urn:ngsi-ld:Machine:chiller-01')
    expect(screen.getByLabelText('Issue')).toHaveFocus()
  })

  test('missing input is identified and nothing is submitted', async () => {
    const user = userEvent.setup()
    open(paths.newIncident())
    await user.click(await screen.findByRole('button', { name: 'Start analysis' }))
    expect(screen.getByLabelText('Machine ID')).toHaveAttribute('aria-invalid', 'true')
    expect(screen.getByText('Enter the machine ID.')).toBeVisible()
    await user.type(screen.getByLabelText('Machine ID'), 'press-brake-01')
    await user.click(screen.getByRole('button', { name: 'Start analysis' }))
    expect(screen.getByLabelText('Issue')).toHaveAttribute('aria-invalid', 'true')
    expect(screen.getByText('Describe the issue.')).toBeVisible()
    expect(store.get().runs).toHaveLength(4)
  })

  test('a failed start keeps the values and shows the reason', async () => {
    const user = userEvent.setup()
    open(paths.newIncident())
    await user.type(await screen.findByLabelText('Machine ID'), 'press-brake-01')
    await user.type(screen.getByLabelText('Issue'), 'Noise')
    writeControls({ failure: { runs: 'unavailable' } })
    await user.click(screen.getByRole('button', { name: 'Start analysis' }))
    expect(await screen.findByText(/Could not start the analysis: runs is unavailable/)).toBeVisible()
    expect(screen.getByLabelText('Machine ID')).toHaveValue('press-brake-01')
    expect(screen.getByLabelText('Issue')).toHaveValue('Noise')
  })

  test('the form is disabled until the start has finished', async () => {
    const user = userEvent.setup()
    open(paths.newIncident())
    await user.type(await screen.findByLabelText('Machine ID'), 'press-brake-01')
    await user.type(screen.getByLabelText('Issue'), 'Noise')
    writeControls({ latencyMs: { runs: 300 } })
    await user.click(screen.getByRole('button', { name: 'Start analysis' }))
    expect(screen.getByRole('button', { name: 'Starting…' })).toBeDisabled()
    expect(screen.getByLabelText('Issue')).toBeDisabled()
    await waitFor(() => expect(window.location.pathname).toMatch(/^\/incidents\/run-/))
  })
})
