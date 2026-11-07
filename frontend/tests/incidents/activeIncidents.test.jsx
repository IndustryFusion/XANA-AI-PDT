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
import { dataspace } from '../../src/data'
import { DataError } from '../../src/data/errors'

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

describe('builder, filter and archive in the list', () => {
  const arrange = (change) => {
    resetMock({ path: '/incidents', controls })
    store.update((s) => { change(s); return s })
    render(<App />)
  }

  test('an escalated run names its machine builder, and others show none', async () => {
    arrange((s) => { s.runs[0].escalation = { ref: 'r1', recipient: { id: 'urn:x:builder', name: 'Builder GmbH' } } })
    const rows = await items()
    expect(within(rows[0]).getByTestId('run-builder')).toHaveTextContent('Machine builder: Builder GmbH')
    expect(within(rows[1]).queryByTestId('run-builder')).toBeNull()
  })

  test('machine names from the registry are shown in the rows, and IDs when it is unavailable', async () => {
    const spy = vi.spyOn(dataspace, 'resolveMachines').mockImplementation(async (ids) => Object.fromEntries(ids.map((id) => [id, `Asset ${id.split(':').pop()}`])))
    open('/incidents')
    const rows = await items()
    expect(await within(rows[0]).findByTestId('machine-name')).toHaveTextContent(`Asset ${store.get().runs[0].machineId.split(':').pop()}`)
    spy.mockRestore()
  })

  test('without the registry the rows show machine IDs', async () => {
    const spy = vi.spyOn(dataspace, 'resolveMachines').mockRejectedValue(new DataError('dataspace', 'unavailable', 'No registry.'))
    open('/incidents')
    const rows = await items()
    await waitFor(() => expect(spy).toHaveBeenCalled())
    expect(within(rows[0]).queryByTestId('machine-name')).toBeNull()
    expect(rows[0]).toHaveTextContent('laser-cutter-01')
    spy.mockRestore()
  })

  test('a builder without a name shows its ID', async () => {
    arrange((s) => { s.runs[1].escalation = { ref: 'r1', recipient: { id: 'urn:x:builder', name: '' } } })
    const rows = await items()
    expect(within(rows[1]).getByTestId('run-builder')).toHaveTextContent('urn:x:builder')
  })

  test('typing part of a machine ID, in any case, narrows the list, and clearing it shows all again', async () => {
    const user = userEvent.setup()
    open('/incidents')
    const all = await items()
    const field = screen.getByLabelText('Filter by machine')
    const target = store.get().runs[0].machineId
    const part = target.slice(-8, -2).toUpperCase()
    await user.type(field, part)
    const kept = within(await list()).getAllByRole('listitem')
    const expected = store.get().runs.filter((r) => r.machineId.toLowerCase().includes(part.toLowerCase()))
    expect(kept).toHaveLength(expected.length)
    expect(kept.length).toBeLessThan(all.length)
    await user.clear(field)
    expect(within(await list()).getAllByRole('listitem')).toHaveLength(all.length)
  })

  test('a filter nothing matches says so and can be cleared', async () => {
    const user = userEvent.setup()
    open('/incidents')
    const all = await items()
    await user.type(screen.getByLabelText('Filter by machine'), 'no-such-machine')
    const region = await list()
    expect(within(region).getByText('No active incidents match the filter.')).toBeVisible()
    await user.click(within(region).getByRole('button', { name: 'Clear filter' }))
    expect(within(await list()).getAllByRole('listitem')).toHaveLength(all.length)
  })

  test('the machine from the URL fills the filter', async () => {
    const machine = (() => { resetMock({ path: '/', controls }); return store.get().runs[0].machineId })()
    open(`/incidents?machine=${encodeURIComponent(machine)}`)
    await items()
    expect(screen.getByLabelText('Filter by machine')).toHaveValue(machine)
    for (const row of within(await list()).getAllByRole('listitem')) expect(row).toHaveTextContent(machine.split(':').pop())
  })

  test('a finished run is archived from its row after confirming, and is in the history', async () => {
    const user = userEvent.setup()
    arrange((s) => { s.runs[0].status = 'failed'; s.runs[0].data = { ...s.runs[0].data, error: 'x' } })
    const runId = store.get().runs[0].runId
    const issue = store.get().runs[0].issue
    const before = (await items()).length
    await user.click(screen.getByRole('button', { name: `Archive: ${issue}` }))
    const dialog = await screen.findByRole('dialog', { name: 'Archive this run?' })
    await user.click(within(dialog).getByRole('button', { name: 'Archive' }))
    // The archive and the list's reload each wait for the mock's latency, which is longer on a busy machine.
    await waitFor(() => expect(store.get().runs.find((r) => r.runId === runId)).toBeUndefined(), { timeout: 5000 })
    await waitFor(async () => expect(within(await list()).getAllByRole('listitem')).toHaveLength(before - 1), { timeout: 5000 })
    expect(store.get().incidents.some((i) => i.issue === issue)).toBe(true)
  })

  test('a refused archive leaves the row and shows why', async () => {
    const user = userEvent.setup()
    arrange((s) => { s.runs[0].status = 'stopped'; s.runs[0].data = { ...s.runs[0].data, closePending: true } })
    const issue = store.get().runs[0].issue
    const before = (await items()).length
    await user.click(screen.getByRole('button', { name: `Archive: ${issue}` }))
    await user.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Archive' }))
    const alert = await within(await list()).findByRole('alert', {}, { timeout: 5000 })
    expect(alert).toHaveTextContent("hasn't been told yet")
    expect(within(await list()).getAllByRole('listitem')).toHaveLength(before)
  })

  test('runs that are not finished offer no archive', async () => {
    open('/incidents')
    await items()
    const finished = store.get().runs.filter((r) => ['completed', 'failed', 'stopped', 'mb_closed'].includes(r.status))
    expect(within(await list()).queryAllByRole('button', { name: /^Archive:/ })).toHaveLength(finished.length)
  })

  test('archiving the run shown in the run view from the list says it is no longer active', async () => {
    const user = userEvent.setup()
    resetMock({ controls })
    const { runId, issue } = store.get().runs[1]
    resetMock({ path: paths.run(runId), controls })
    render(<App />)
    await user.click(await screen.findByRole('button', { name: 'Stop run…' }))
    await user.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Stop run' }))
    await user.click(await within(await list()).findByRole('button', { name: `Archive: ${issue}` }))
    await user.click(within(await screen.findByRole('dialog', { name: 'Archive this run?' })).getByRole('button', { name: 'Archive' }))
    expect(await screen.findByRole('heading', { name: 'This run is not active' }, { timeout: 5000 })).toBeVisible()
    expect(store.get().runs.find((r) => r.runId === runId)).toBeUndefined()
  })
})
