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

import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { paths } from '../../src/app/router'
import { store } from '../../src/data/sources/mock'
import { renderApp, renderAppWith } from '../helpers'

const controls = { authEnabled: false, speed: 50 }
const open = (path) => renderApp({ path, controls })
const list = () => screen.findByRole('region', { name: 'Past incidents' })
const rows = async () => within(await list()).findAllByRole('listitem')

describe('incident list', () => {
  test('lists past incidents newest first with machine, issue, outcome and date', async () => {
    open('/history')
    const items = await rows()
    expect(items).toHaveLength(12)
    expect(items[0]).toHaveTextContent('Curing oven reaches temperature 10 minutes late')
    expect(items[0]).toHaveTextContent('coating-01')
    expect(within(items[0]).getByText('Resolved')).toBeVisible()
    expect(items[0].querySelector('time')).toHaveAttribute('datetime')
    const dates = items.map((li) => li.querySelector('time').getAttribute('datetime'))
    expect([...dates].sort().reverse()).toEqual(dates)
  })

  test('an incident from an alert says so in the list and its details', async () => {
    renderAppWith(() => { store.update((s) => { s.incidents[0].source = 'alert'; return s }) }, { path: '/history', controls })
    const [first] = await screen.findAllByTestId('run-source')
    expect(first).toHaveTextContent('Alert')
    await userEvent.setup().click(first.closest('a'))
    await waitFor(() => expect(screen.getAllByTestId('run-source')).toHaveLength(2))
    expect(screen.getAllByTestId('run-source')[1]).toHaveTextContent('Alert')
  })

  test('search and outcome filter narrow the list', async () => {
    const user = userEvent.setup()
    open('/history')
    await rows()
    await user.type(screen.getByLabelText('Search'), 'coolant')
    await waitFor(async () => expect(await rows()).toHaveLength(1))
    await user.clear(screen.getByLabelText('Search'))
    await user.selectOptions(screen.getByLabelText('Outcome'), 'failed')
    await waitFor(async () => expect((await rows()).map((li) => li.textContent)).toEqual([expect.stringContaining('Powder output fluctuates')]))
  })

  test('date range filters by closing date', async () => {
    const user = userEvent.setup()
    open('/history')
    const first = (await rows())[0].querySelector('time').getAttribute('datetime')
    const day = new Date(first)
    const iso = `${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, '0')}-${String(day.getDate()).padStart(2, '0')}`
    await user.type(screen.getByLabelText('Closed from'), iso)
    await waitFor(async () => expect(await rows()).toHaveLength(1))
  })

  test('the machine filter from an entity reference is named and can be cleared', async () => {
    const user = userEvent.setup()
    open(paths.historyFor('urn:ngsi-ld:Machine:chiller-01'))
    await waitFor(async () => expect(await rows()).toHaveLength(2))
    for (const li of await rows()) expect(li).toHaveTextContent('chiller-01')
    expect(screen.getByLabelText('Machine')).toHaveValue('urn:ngsi-ld:Machine:chiller-01')
    await user.click(screen.getByRole('link', { name: 'Clear machine filter' }))
    await waitFor(async () => expect(await rows()).toHaveLength(12))
  })

  test('no matches: an empty state offers to clear the filters', async () => {
    const user = userEvent.setup()
    open(paths.historyFor('urn:ngsi-ld:Machine:chiller-01'))
    await rows()
    await user.type(screen.getByLabelText('Search'), 'no such incident')
    const region = await list()
    expect(await within(region).findByText('No incidents match the search and filters.')).toBeVisible()
    await user.click(within(region).getByRole('button', { name: 'Clear filters' }))
    await waitFor(async () => expect(await rows()).toHaveLength(12))
    expect(window.location.search).toBe('')
  })
})

describe('incident detail', () => {
  test('selecting an incident shows its details and puts it in the URL', async () => {
    const user = userEvent.setup()
    open('/history')
    await user.click(await within(await list()).findByRole('link', { name: /Coolant flow alarm/ }))
    expect(window.location.pathname).toBe('/history/32')
    expect(await screen.findByRole('heading', { name: 'Incident #32', level: 2 })).toBeVisible()
    const summary = screen.getByRole('region', { name: 'Summary' })
    const field = (label) => within(summary).getByText(label, { selector: 'dt' }).nextSibling
    expect(field('Issue')).toHaveTextContent('Coolant flow alarm after weekend start-up')
    expect(field('Root cause')).toHaveTextContent('Condenser fouling')
    expect(field('Decision')).toBeInTheDocument()
    expect(field('Resolution')).toHaveTextContent('Clean the condenser')
    expect(field('Machine-builder reference')).toHaveTextContent(/ESC-\d+ · CoolFlow Process Cooling/)
    const conversation = screen.getByRole('region', { name: 'Conversation with CoolFlow Process Cooling' })
    expect(within(conversation).getAllByRole('listitem').length).toBeGreaterThan(1)
  })

  test('expanding a trace step shows its inputs and outputs as labelled fields', async () => {
    const user = userEvent.setup()
    open(paths.incident('30'))
    const trace = await screen.findByRole('region', { name: 'Agent trace' })
    await user.click(within(trace).getByRole('button', { name: 'Show details of Decide step' }))
    const input = within(trace).getByRole('region', { name: 'Input of Decide step' })
    const output = within(trace).getByRole('region', { name: 'Output of Decide step' })
    expect(within(input).getByText('Threshold', { selector: 'dt' }).nextSibling).toHaveTextContent('75%')
    expect(within(output).getByText('Root cause', { selector: 'dt' }).nextSibling).toHaveTextContent('Internal leakage in the proportional valve')
  })

  test('a never escalated incident has no conversation and says so', async () => {
    open(paths.incident('30'))
    expect(await screen.findByText('Resolved without the machine builder: this incident was never escalated.')).toBeVisible()
    expect(screen.queryByRole('region', { name: /^Conversation/ })).not.toBeInTheDocument()
    expect(screen.queryByText('Machine-builder reference')).not.toBeInTheDocument()
  })

  test('reopening starts a new run with the conversation and opens it in Active incidents', async () => {
    const user = userEvent.setup()
    open(paths.incident('35'))
    await user.click(await screen.findByRole('button', { name: 'Reopen…' }))
    const dialog = screen.getByRole('dialog', { name: 'Reopen incident #35?' })
    expect(dialog).toHaveTextContent('the conversation with the machine builder continues')
    await user.click(within(dialog).getByRole('button', { name: 'Reopen' }))
    await waitFor(() => expect(window.location.pathname).toBe('/incidents/run-1005'))
    expect(await screen.findByRole('heading', { name: 'Incident #35', level: 2 })).toBeVisible()
    expect(within(await screen.findByRole('region', { name: 'Open runs' })).getByRole('link', { name: /Extraction volume too low/ })).toHaveAttribute('aria-current', 'true')
    expect(await screen.findByRole('tab', { name: 'Conversation' })).toHaveAttribute('aria-selected', 'true')
    expect(within(await screen.findByRole('region', { name: 'Message thread' })).getByText('Conversation reopened by the operator.')).toBeVisible()
  })
})
