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

import { act, createEvent, fireEvent, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { paths } from '../../src/app/router'
import { raiseAlert, store } from '../../src/data/sources/mock'
import { SEVERITY_RANK } from '../../src/data/sources/mock/alertsArea'
import { REFRESH_KEY } from '../../src/features/alerts/Alerts'
import { iriParts } from '../../src/features/alerts/AlertText'
import { writeControls } from '../../src/data/sources/mock/controls'
import { renderApp } from '../helpers'

const open = (path = paths.alerts()) => renderApp({ path, controls: { authEnabled: false } })
const listRegion = () => screen.findByRole('region', { name: 'Alert list' })
const rows = async () => within(await listRegion()).queryAllByRole('row').slice(1).filter((r) => r.dataset.alert)
const rowIds = async () => (await rows()).map((r) => r.dataset.alert)
const row = (id) => document.querySelector(`tr[data-alert="${id}"]`)
const stored = (id) => store.get().alerts.find((a) => a.id === id)
const withStatus = (status) => store.get().alerts.filter((a) => a.status === status)
const search = () => Object.fromEntries(new URLSearchParams(window.location.search))

async function waitForRows(count) {
  await waitFor(async () => expect(await rows()).toHaveLength(count))
}

describe('list and filters', () => {
  test('cut-off cells carry their full text, the resource as its full IRI, and the duplicates column counts duplicates', async () => {
    open()
    await waitFor(async () => expect((await rows()).length).toBeGreaterThan(3))
    const listed = (await rowIds()).map(stored)
    const again = listed.find((a) => a.duplicateCount > 0)
    const once = listed.find((a) => a.duplicateCount === 0)
    const cells = [...row(again.id).cells]
    for (const text of [again.resource, again.event, again.text, again.service.join(', ')]) {
      const cell = cells.find((c) => c.title === text)
      expect(cell, text).toBeTruthy()
      expect(cell).toHaveClass('alert-table__clip')
    }
    expect(cells.at(-1)).toHaveTextContent(new RegExp(`^${again.duplicateCount}$`))
    expect([...row(once.id).cells].at(-1)).toHaveTextContent(/^$/)
    expect(screen.getByRole('columnheader', { name: 'Duplicates' })).toBeVisible()
  })

  test('default: open and acknowledged alerts, most severe and newest first, with all columns', async () => {
    open()
    const expected = store.get().alerts
      .filter((a) => ['open', 'ack'].includes(a.status))
      .sort((a, b) => SEVERITY_RANK.indexOf(a.severity) - SEVERITY_RANK.indexOf(b.severity) || b.createTime.localeCompare(a.createTime))
    await waitForRows(expected.length)
    expect(await rowIds()).toEqual(expected.map((a) => a.id))
    const first = row(expected[0].id)
    expect(within(first).getByText(expected[0].text)).toBeVisible()
    expect(within(first).getByTitle(expected[0].resource)).toHaveTextContent(expected[0].resource.split(':').at(-1))
    // The actions are in the row's context menu, not behind buttons on the row.
    expect(within(first).queryAllByRole('button')).toHaveLength(0)
    expect(within(first).getByText(expected[0].service[0])).toBeVisible()
    expect(within(first).getAllByText(/Critical|Major|Minor|Warning|Informational/)[0]).toBeVisible()
    expect(within(first).getAllByText(/^(Open|Acknowledged)$/)[0]).toBeVisible()
    expect(first.querySelector('time')).toHaveTextContent(/min|h|d|just now/)
    expect(screen.getByLabelText('Status')).toHaveValue('open,ack')
  })

  test('selecting a severity in the summary filters the list and marks it as selected', async () => {
    const user = userEvent.setup()
    open()
    const summary = await screen.findByRole('group', { name: 'Alerts by severity' })
    const critical = await within(summary).findByRole('button', { name: /Critical/ })
    const count = Number(critical.textContent.match(/\d+/)[0])
    await user.click(critical)
    expect(critical).toHaveAttribute('aria-pressed', 'true')
    expect(search()).toEqual({ severity: 'critical' })
    await waitForRows(count)
    for (const r of await rows()) expect(within(r).getByText('Critical')).toBeVisible()
    // The summary still counts the other severities of the filter.
    expect(within(summary).getByRole('button', { name: /Major/ })).toHaveAttribute('aria-pressed', 'false')
    await user.click(critical)
    expect(search()).toEqual({})
  })

  test('environment and text combine, and the URL reflects the filter', async () => {
    const user = userEvent.setup()
    open()
    await screen.findByRole('option', { name: 'Commissioning' })
    await user.selectOptions(screen.getByLabelText('Status'), 'All')
    await user.selectOptions(screen.getByLabelText('Environment'), 'Commissioning')
    await user.type(screen.getByLabelText('Search'), 'press brake')
    const expected = store.get().alerts.filter((a) => a.environment === 'Commissioning' && /press brake/i.test(a.text))
    expect(expected.length).toBeGreaterThan(0)
    await waitFor(async () => expect((await rowIds()).sort()).toEqual(expected.map((a) => a.id).sort()))
    expect(search()).toEqual({ status: 'open,ack,shelved,closed', environment: 'Commissioning', text: 'press brake' })
  })

  test('filters from the URL, and no matches', async () => {
    open(`${paths.alerts()}?text=${encodeURIComponent('no such alert')}`)
    expect(await within(await listRegion()).findByText('No alerts match the current filter.')).toBeVisible()
    expect(screen.getByLabelText('Search')).toHaveValue('no such alert')
  })

  test('newest first on request', async () => {
    const user = userEvent.setup()
    open()
    await waitFor(async () => expect((await rows()).length).toBeGreaterThan(3))
    await user.selectOptions(screen.getByLabelText('Order'), 'time')
    const expected = store.get().alerts.filter((a) => ['open', 'ack'].includes(a.status)).sort((a, b) => b.createTime.localeCompare(a.createTime))
    await waitFor(async () => expect(await rowIds()).toEqual(expected.map((a) => a.id)))
  })
})

describe('coming back', () => {
  test('after another area, the filters, the open alert and the checked rows are as they were left', async () => {
    const user = userEvent.setup()
    open(`${paths.alerts()}?environment=Production`)
    await waitFor(async () => expect((await rows()).length).toBeGreaterThan(3))
    const [firstId, secondId] = await rowIds()
    await user.click(within(row(secondId)).getByRole('checkbox'))
    fireEvent.click(within(row(firstId)).getAllByRole('link')[0])
    await screen.findByRole('article', { name: `Alert ${firstId}` })
    const left = `${window.location.pathname}${window.location.search}`

    const nav = () => within(screen.getByRole('navigation', { name: 'Main' }))
    await user.click(nav().getByRole('link', { name: 'Data explorer' }))
    await waitFor(() => expect(window.location.pathname).toContain('/explorer'))
    await user.click(nav().getByRole('link', { name: 'Alerts' }))

    expect(await screen.findByRole('article', { name: `Alert ${firstId}` })).toBeVisible()
    expect(`${window.location.pathname}${window.location.search}`).toBe(left)
    expect(within(row(secondId)).getByRole('checkbox')).toBeChecked()
    expect(screen.getByText('1 selected')).toBeVisible()
  })

  test('the last list is shown at once, at the scroll position it had, and the next answer replaces it', async () => {
    const user = userEvent.setup()
    open()
    await waitFor(async () => expect((await rows()).length).toBeGreaterThan(3))
    const before = await rowIds()
    Object.defineProperty(window, 'scrollY', { value: 420, configurable: true })
    const nav = () => within(screen.getByRole('navigation', { name: 'Main' }))
    await user.click(nav().getByRole('link', { name: 'Data explorer' }))
    await waitFor(() => expect(window.location.pathname).toContain('/explorer'))
    Object.defineProperty(window, 'scrollY', { value: 0, configurable: true })

    writeControls({ authEnabled: false, latencyMs: { alerts: 300 } })
    const raised = raiseAlert({ severity: 'critical' })
    const scrollTo = vi.spyOn(window, 'scrollTo')
    await user.click(nav().getByRole('link', { name: 'Alerts' }))
    // Before the answer: the list as it was left.
    expect(await rowIds()).toEqual(before)
    await waitFor(() => expect(scrollTo).toHaveBeenCalledWith(0, 420))
    // The answer brings the alert raised meanwhile.
    await waitFor(() => expect(row(raised.id)).not.toBeNull(), { timeout: 2000 })
  })

  test('a list still loading for a new filter is not kept under that filter', async () => {
    const user = userEvent.setup()
    open()
    await waitFor(async () => expect((await rows()).length).toBeGreaterThan(3))
    writeControls({ authEnabled: false, latencyMs: { alerts: 400 } })
    const summary = screen.getByRole('group', { name: /severity/i })
    await user.click(within(summary).getAllByRole('button')[0])
    const chosen = search().severity
    expect(chosen).toBeTruthy()
    const nav = () => within(screen.getByRole('navigation', { name: 'Main' }))
    await user.click(nav().getByRole('link', { name: 'Data explorer' }))
    await waitFor(() => expect(window.location.pathname).toContain('/explorer'))
    await user.click(nav().getByRole('link', { name: 'Alerts' }))
    // The unfiltered list was never the answer to this filter, so it is not shown under it.
    expect((await rowIds()).map(stored).every((a) => a.severity === chosen)).toBe(true)
    await waitFor(async () => expect((await rows()).length).toBeGreaterThan(0), { timeout: 2000 })
    expect((await rowIds()).map(stored).every((a) => a.severity === chosen)).toBe(true)
  })

  test('after a filter change, the scroll position is kept for the new address', async () => {
    const user = userEvent.setup()
    open()
    await waitFor(async () => expect((await rows()).length).toBeGreaterThan(3))
    await user.selectOptions(screen.getByLabelText('Environment'), 'Production')
    await waitFor(() => expect(search().environment).toBe('Production'))
    Object.defineProperty(window, 'scrollY', { value: 300, configurable: true })
    const nav = () => within(screen.getByRole('navigation', { name: 'Main' }))
    await user.click(nav().getByRole('link', { name: 'Data explorer' }))
    await waitFor(() => expect(window.location.pathname).toContain('/explorer'))
    Object.defineProperty(window, 'scrollY', { value: 0, configurable: true })
    const scrollTo = vi.spyOn(window, 'scrollTo')
    await user.click(nav().getByRole('link', { name: 'Alerts' }))
    expect(search().environment).toBe('Production')
    await waitFor(() => expect(scrollTo).toHaveBeenCalledWith(0, 300))
  })

  test('the kept scroll position applies only back at the address it was left at', async () => {
    const user = userEvent.setup()
    open()
    await waitFor(async () => expect((await rows()).length).toBeGreaterThan(3))
    Object.defineProperty(window, 'scrollY', { value: 420, configurable: true })
    const nav = () => within(screen.getByRole('navigation', { name: 'Main' }))
    await user.click(nav().getByRole('link', { name: 'Data explorer' }))
    await waitFor(() => expect(window.location.pathname).toContain('/explorer'))
    Object.defineProperty(window, 'scrollY', { value: 0, configurable: true })
    const scrollTo = vi.spyOn(window, 'scrollTo')
    const [alert] = withStatus('open')
    act(() => { window.history.pushState(null, '', paths.alert(alert.id)); window.dispatchEvent(new PopStateEvent('popstate')) })
    await screen.findByRole('article', { name: `Alert ${alert.id}` })
    await new Promise((r) => requestAnimationFrame(r))
    expect(scrollTo).not.toHaveBeenCalledWith(0, 420)
  })

  test('when the session ends, the Alerts area forgets its view', async () => {
    const user = userEvent.setup()
    const signIn = async () => {
      await user.type(await screen.findByLabelText('Username'), 'operator')
      await user.type(screen.getByLabelText('Password'), 'operator')
      await user.click(screen.getByRole('button', { name: 'Sign in' }))
    }
    renderApp({ path: `${paths.alerts()}?environment=Production` })
    await signIn()
    await waitFor(async () => expect((await rows()).length).toBeGreaterThan(1))
    const [firstId] = await rowIds()
    await user.click(within(row(firstId)).getByRole('checkbox'))
    const nav = () => within(screen.getByRole('navigation', { name: 'Main' }))
    await user.click(nav().getByRole('link', { name: 'Data explorer' }))
    await waitFor(() => expect(window.location.pathname).toContain('/explorer'))
    await user.click(screen.getByRole('button', { name: /account and factory details/ }))
    await user.click(screen.getByRole('button', { name: 'Sign out' }))
    await signIn()

    expect(await nav().findByRole('link', { name: 'Alerts' })).toHaveAttribute('href', paths.alerts())
    await user.click(nav().getByRole('link', { name: 'Alerts' }))
    await waitFor(async () => expect((await rows()).length).toBeGreaterThan(1))
    expect(search()).toEqual({})
    expect(screen.queryByRole('region', { name: 'Selected alerts' })).not.toBeInTheDocument()
  })
})

describe('automatic refresh', () => {
  afterEach(() => vi.useRealTimers())

  test('a new alert appears at the next refresh without losing filter or selection', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    open(`${paths.alerts()}?environment=Production`)
    await waitFor(async () => expect((await rows()).length).toBeGreaterThan(3))
    const [firstId] = await rowIds()
    await user.click(within(row(firstId)).getByRole('checkbox'))
    await user.selectOptions(screen.getByLabelText('Automatic refresh'), '10000')
    expect(localStorage.getItem(REFRESH_KEY)).toBe('10000')

    const alert = raiseAlert()
    expect(row(alert.id)).toBeNull()
    await act(() => vi.advanceTimersByTimeAsync(10_500))
    await waitFor(() => expect(row(alert.id)).not.toBeNull())
    expect(within(row(firstId)).getByRole('checkbox')).toBeChecked()
    expect(screen.getByText('1 selected')).toBeVisible()
    expect(search()).toEqual({ environment: 'Production' })
  })

  test('a refresh every second shows a new alert within a second', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    open()
    await waitFor(async () => expect((await rows()).length).toBeGreaterThan(3))
    await user.selectOptions(screen.getByLabelText('Automatic refresh'), '1000')
    expect(screen.getByLabelText('Automatic refresh')).toHaveDisplayValue('1 s')
    expect(localStorage.getItem(REFRESH_KEY)).toBe('1000')
    const alert = raiseAlert({ severity: 'critical' })
    await act(() => vi.advanceTimersByTimeAsync(1_200))
    await waitFor(() => expect(row(alert.id)).not.toBeNull())
  })

  test('with refresh off the list changes only on request', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    localStorage.setItem(REFRESH_KEY, '0')
    open()
    await waitFor(async () => expect((await rows()).length).toBeGreaterThan(3))
    const alert = raiseAlert()
    await act(() => vi.advanceTimersByTimeAsync(120_000))
    expect(row(alert.id)).toBeNull()
    await user.click(screen.getByRole('button', { name: 'Refresh now' }))
    await waitFor(() => expect(row(alert.id)).not.toBeNull())
  })
})

describe('actions', () => {
  test('bulk acknowledge with a note: each becomes acknowledged and the result is reported per alert', async () => {
    const user = userEvent.setup()
    open()
    const [a, b] = withStatus('open')
    await waitFor(() => expect(row(a.id)).not.toBeNull())
    await user.click(within(row(a.id)).getByRole('checkbox'))
    await user.click(within(row(b.id)).getByRole('checkbox'))
    const bar = screen.getByRole('region', { name: 'Selected alerts' })
    expect(bar).toHaveTextContent('2 selected')
    await user.click(within(bar).getByRole('button', { name: 'Acknowledge…' }))
    const dialog = screen.getByRole('dialog', { name: 'Acknowledge 2 alerts' })
    await user.type(within(dialog).getByLabelText('Note (optional)'), 'Technician informed.')
    await user.click(within(dialog).getByRole('button', { name: 'Acknowledge' }))

    const results = await screen.findByRole('region', { name: 'Acknowledge: 2 succeeded, 0 failed' })
    expect(within(results).getAllByRole('listitem').map((li) => li.textContent)).toEqual([
      `${a.id}: Acknowledged, now Acknowledged`, `${b.id}: Acknowledged, now Acknowledged`,
    ])
    await waitFor(() => expect(within(row(a.id)).getByText('Acknowledged')).toBeVisible())
    expect(within(row(b.id)).getByText('Acknowledged')).toBeVisible()
    expect(screen.queryByRole('region', { name: 'Selected alerts' })).not.toBeInTheDocument()
    expect(stored(a.id).history.at(-1)).toMatchObject({ status: 'ack', text: 'Technician informed.' })
  })

  test('partial failure: failed alerts stay selected with the reason, the others show their new status', async () => {
    const user = userEvent.setup()
    open()
    const [opened] = withStatus('open')
    const [acked] = withStatus('ack')
    await waitFor(() => expect(row(acked.id)).not.toBeNull())
    await user.click(within(row(opened.id)).getByRole('checkbox'))
    await user.click(within(row(acked.id)).getByRole('checkbox'))
    await user.click(screen.getByRole('button', { name: 'Acknowledge…' }))
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Acknowledge' }))

    const results = await screen.findByRole('region', { name: 'Acknowledge: 1 succeeded, 1 failed' })
    expect(results).toHaveTextContent(`${acked.id}: failed: The alert is acknowledged and cannot be acknowledged.`)
    expect(screen.getByRole('region', { name: 'Selected alerts' })).toHaveTextContent('1 selected')
    expect(within(row(acked.id)).getByRole('checkbox')).toBeChecked()
    expect(row(acked.id)).toHaveTextContent('Action failed: The alert is acknowledged and cannot be acknowledged.')
    // The reason is never cut off: its cell wraps and carries it in its tooltip too.
    const reason = within(row(acked.id)).getByText('Action failed: The alert is acknowledged and cannot be acknowledged.').closest('td')
    expect(reason).toHaveClass('alert-table__wrap')
    expect(reason.title).toContain('Action failed: The alert is acknowledged and cannot be acknowledged.')
    await waitFor(() => expect(within(row(opened.id)).getByText('Acknowledged')).toBeVisible())
    expect(within(row(opened.id)).getByRole('checkbox')).not.toBeChecked()
  })

  test('select all and clear selection', async () => {
    const user = userEvent.setup()
    open()
    await waitFor(async () => expect((await rows()).length).toBeGreaterThan(3))
    await user.click(screen.getByLabelText('Select all listed alerts'))
    expect(screen.getByText(`${(await rows()).length} selected`)).toBeVisible()
    await user.click(screen.getByRole('button', { name: 'Clear selection' }))
    expect(screen.queryByRole('region', { name: 'Selected alerts' })).not.toBeInTheDocument()
  })
})

describe('alert detail and context', () => {
  test('selecting an alert shows its attributes and ordered history, and the URL names it', async () => {
    const user = userEvent.setup()
    open(`${paths.alerts()}?status=closed`)
    const [closed] = withStatus('closed')
    await waitFor(() => expect(row(closed.id)).not.toBeNull())
    await user.click(within(row(closed.id)).getByRole('link', { name: `${closed.event} (${closed.id})` }))
    expect(window.location.pathname).toBe(paths.alert(closed.id))
    expect(search()).toEqual({ status: 'closed' })
    const detail = await screen.findByRole('article', { name: `Alert ${closed.id}` })
    expect(detail).toHaveTextContent(closed.text)
    for (const label of ['Resource', 'Event', 'Environment', 'Service', 'Created', 'Last received', 'Duplicates']) {
      expect(within(detail).getByText(label)).toBeVisible()
    }
    const history = within(detail).getByRole('region', { name: 'History' })
    expect(within(history).getAllByRole('listitem').map((li) => li.querySelector('[data-status]').dataset.status)).toEqual(['open', 'ack', 'closed'])
    expect(within(history).getAllByRole('listitem')[2]).toHaveTextContent('Value back within limits.')
  })

  test('a single action from the detail appends to its history', async () => {
    const user = userEvent.setup()
    const [alert] = withStatus('open')
    open(paths.alert(alert.id))
    const detail = await screen.findByRole('article', { name: `Alert ${alert.id}` })
    await user.click(within(detail).getByRole('button', { name: 'Shelve…' }))
    const dialog = screen.getByRole('dialog', { name: `Shelve alert ${alert.id}` })
    await user.type(within(dialog).getByLabelText('Note (optional)'), 'Maintenance tomorrow.')
    await user.click(within(dialog).getByRole('button', { name: 'Shelve' }))
    await waitFor(() => expect(within(within(detail).getByRole('region', { name: 'History' })).getAllByRole('listitem').at(-1)).toHaveTextContent('Maintenance tomorrow.'))
    expect(within(detail).getByRole('button', { name: 'Unshelve…' })).toBeVisible()
  })

  test('an unknown alert is not found', async () => {
    open(paths.alert('alert-999'))
    expect(await screen.findByRole('heading', { name: 'Alert not found' })).toBeVisible()
  })

  test('jumps to the entity and its incidents', async () => {
    const [alert] = withStatus('open')
    open(paths.alert(alert.id))
    const detail = await screen.findByRole('article', { name: `Alert ${alert.id}` })
    expect(within(detail).getByRole('link', { name: `Open ${alert.resource} in the data explorer` })).toHaveAttribute('href', paths.entity(alert.resource))
    expect(within(detail).getByRole('link', { name: 'Show active incidents of this machine' })).toHaveAttribute('href', paths.activeIncidentsFor(alert.resource))
    expect(within(detail).getByRole('link', { name: 'Show incident history of this machine' })).toHaveAttribute('href', paths.historyFor(alert.resource))
  })

  test('starting an incident opens the form with the resource as machine and the alert text as issue', async () => {
    const user = userEvent.setup()
    const [alert] = withStatus('open')
    open(paths.alert(alert.id))
    const detail = await screen.findByRole('article', { name: `Alert ${alert.id}` })
    await user.click(within(detail).getByRole('link', { name: 'Start new incident' }))
    expect(await screen.findByRole('heading', { level: 1, name: 'Active incidents' })).toBeVisible()
    expect(await screen.findByLabelText('Machine ID')).toHaveValue(alert.resource)
    expect(screen.getByLabelText('Issue')).toHaveValue(alert.text)
  })
})

describe('context menu and quick start', () => {
  const menuItems = () => within(screen.getByRole('menu')).getAllByRole('menuitem').map((m) => m.textContent)

  test('a right click on a row offers start incident, the context jumps and the actions for its status', async () => {
    const user = userEvent.setup()
    const [alert] = withStatus('open')
    open()
    await waitFor(() => expect(row(alert.id)).toBeTruthy())
    fireEvent.contextMenu(within(row(alert.id)).getByText(alert.text))
    const menu = screen.getByRole('menu', { name: `Actions for alert ${alert.id}` })
    expect(menuItems()).toEqual([
      'Start new incident', 'Open details', 'Open resource in the data explorer', 'Show active incidents', 'Show incident history',
      'Acknowledge…', 'Shelve…', 'Close…', 'Copy resource IRI', 'Copy alert ID',
    ])
    expect(within(menu).getByRole('menuitem', { name: 'Start new incident' })).toHaveFocus()
    await user.click(within(menu).getByRole('menuitem', { name: 'Start new incident' }))
    expect(await screen.findByLabelText('Machine ID')).toHaveValue(alert.resource)
    expect(screen.getByLabelText('Issue')).toHaveValue(alert.text)
  })

  test('the keyboard opens the menu with Shift+F10, arrows move, Escape closes and returns focus', async () => {
    const user = userEvent.setup()
    const [alert] = withStatus('open')
    open()
    await waitFor(() => expect(row(alert.id)).toBeTruthy())
    const checkbox = within(row(alert.id)).getByRole('checkbox')
    checkbox.focus()
    await user.keyboard('{Shift>}{F10}{/Shift}')
    const menu = screen.getByRole('menu')
    expect(within(menu).getByRole('menuitem', { name: 'Start new incident' })).toHaveFocus()
    await user.keyboard('{ArrowDown}')
    expect(within(menu).getByRole('menuitem', { name: 'Open details' })).toHaveFocus()
    await user.keyboard('{End}')
    expect(within(menu).getByRole('menuitem', { name: 'Copy alert ID' })).toHaveFocus()
    await user.keyboard('{Escape}')
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
    expect(checkbox).toHaveFocus()
  })

  test('a long press on a row opens its menu on a touch screen', async () => {
    const [alert] = withStatus('open')
    open()
    await waitFor(() => expect(row(alert.id)).toBeTruthy())
    vi.useFakeTimers()
    try {
      const cell = row(alert.id).cells[1]
      const press = createEvent.pointerDown(cell, { clientX: 20, clientY: 20 })
      Object.defineProperty(press, 'pointerType', { value: 'touch' })
      fireEvent(cell, press)
      act(() => { vi.advanceTimersByTime(600) })
      expect(screen.getByRole('menu', { name: `Actions for alert ${alert.id}` })).toBeVisible()
    } finally {
      vi.useRealTimers()
    }
  })

  test("Shift+F10 on the row's event opens the same menu, and an action opens its dialog", async () => {
    const user = userEvent.setup()
    const [alert] = withStatus('ack')
    open()
    await waitFor(() => expect(row(alert.id)).toBeTruthy())
    within(row(alert.id)).getByRole('link', { name: `${alert.event} (${alert.id})` }).focus()
    await user.keyboard('{Shift>}{F10}{/Shift}')
    expect(menuItems()).toContain('Unacknowledge…')
    await user.click(screen.getByRole('menuitem', { name: 'Unacknowledge…' }))
    expect(screen.getByRole('dialog', { name: `Unacknowledge alert ${alert.id}` })).toBeVisible()
  })

  test('clicking a row opens its detail', async () => {
    const user = userEvent.setup()
    const [alert] = withStatus('open')
    open()
    await waitFor(() => expect(row(alert.id)).toBeTruthy())
    await user.click(within(row(alert.id)).getByText(alert.text))
    expect(await screen.findByRole('article', { name: `Alert ${alert.id}` })).toBeVisible()
    expect(window.location.pathname).toBe(paths.alert(alert.id))
  })

  test('selecting a single alert offers to start an incident right away', async () => {
    const user = userEvent.setup()
    const [first, second] = withStatus('open')
    open()
    await waitFor(() => expect(row(first.id)).toBeTruthy())
    await user.click(within(row(first.id)).getByRole('checkbox'))
    const bar = screen.getByRole('region', { name: 'Selected alerts' })
    expect(within(bar).getByRole('link', { name: 'Start new incident' })).toHaveAttribute('href', paths.newIncident(first.resource, first.text))
    await user.click(within(row(second.id)).getByRole('checkbox'))
    expect(within(bar).queryByRole('link', { name: 'Start new incident' })).not.toBeInTheDocument()
  })
})

describe('a search that stopped early', () => {
  test('says so, and that the numbers count only what was searched', async () => {
    renderApp({ path: `${paths.alerts()}?text=zzz-no-such`, controls: { authEnabled: false, searchCap: 2 } })
    expect(await screen.findByText(/Only the first 2 alerts of this filter were searched/)).toHaveAttribute('role', 'status')
  })

  test('says nothing without a limit', async () => {
    renderApp({ path: `${paths.alerts()}?text=zzz-no-such`, controls: { authEnabled: false } })
    await screen.findByText('No alerts match the current filter.')
    expect(screen.queryByText(/of this filter were searched/)).toBeNull()
  })
})

describe('IRIs in the detail', () => {
  const PUMPS = 'http://opcfoundation.org/UA/Pumps/'
  const RESOURCE = 'urn:ngsi-ld:Pump:p-1'

  test('names attributes, sub-attributes after ==>, entities and vocabulary terms apart', () => {
    const text = `CountConstraintComponent(${PUMPS}hasPorts[0] ==> ${PUMPS}Flow) for ${RESOURCE}. expected datatypes="http://www.w3.org/2001/XMLSchema#double"`
    const iris = iriParts(text).filter((p) => p.iri)
    expect(iris).toEqual([
      { iri: `${PUMPS}hasPorts`, levels: [`${PUMPS}hasPorts`] },
      { iri: `${PUMPS}Flow`, levels: [`${PUMPS}hasPorts`, `${PUMPS}Flow`] },
      { iri: RESOURCE, levels: null },
      { iri: 'http://www.w3.org/2001/XMLSchema#double', levels: null },
    ])
    expect(iriParts(text).map((p) => p.text ?? p.iri).join('')).toBe(text)
  })

  test('an IRI starts at a word boundary, and an arrow without spaces still names a sub-attribute', () => {
    expect(iriParts('the pump failed to turn:on').filter((p) => p.iri)).toEqual([])
    const text = `CountConstraintComponent(${PUMPS}hasPorts[0]==>${PUMPS}Flow)`
    expect(iriParts(text).filter((p) => p.iri)).toEqual([
      { iri: `${PUMPS}hasPorts`, levels: [`${PUMPS}hasPorts`] },
      { iri: `${PUMPS}Flow`, levels: [`${PUMPS}hasPorts`, `${PUMPS}Flow`] },
    ])
    expect(iriParts(text).map((p) => p.text ?? p.iri).join('')).toBe(text)
  })

  test("the resource's menu copies its IRI, and an IRI's open menu is not inside a paragraph", async () => {
    const [alert] = withStatus('open')
    open(paths.alert(alert.id))
    store.update((state) => {
      Object.assign(state.alerts.find((a) => a.id === alert.id), { text: `Validation failed for ${alert.resource}.` })
      return state
    })
    const detail = await screen.findByRole('article', { name: `Alert ${alert.id}` })
    const resource = within(detail).getByRole('link', { name: alert.resource })
    fireEvent.contextMenu(resource, { clientX: 10, clientY: 10 })
    expect(within(screen.getByRole('menu')).getByRole('menuitem', { name: 'Copy IRI' })).toBeVisible()
    fireEvent.keyDown(screen.getByRole('menu'), { key: 'Escape' })

    fireEvent.contextMenu(within(detail.querySelector('.alert-detail__text')).getByTitle(alert.resource), { clientX: 10, clientY: 10 })
    expect(screen.getByRole('menu').closest('p')).toBeNull()
  })

  test("a right click on an attribute IRI goes to it in the data explorer, below the alert's resource", async () => {
    const user = userEvent.setup()
    const [alert] = withStatus('open')
    const attribute = `${PUMPS}hasEnergyConsumption`
    open(paths.alert(alert.id))
    store.update((state) => {
      Object.assign(state.alerts.find((a) => a.id === alert.id), { event: `OrConstraintComponent(${attribute})` })
      return state
    })
    const detail = await screen.findByRole('article', { name: `Alert ${alert.id}` })
    const iri = within(detail).getByTitle(attribute)
    fireEvent.contextMenu(iri, { clientX: 10, clientY: 10 })
    const menu = screen.getByRole('menu')
    expect(within(menu).getAllByRole('menuitem').map((m) => m.textContent)).toEqual(['Go to the attribute in the data explorer', 'Copy IRI', 'Copy resource IRI'])
    await user.click(within(menu).getByRole('menuitem', { name: 'Go to the attribute in the data explorer' }))
    expect(`${window.location.pathname}${window.location.search}`).toBe(paths.entity(alert.resource, [attribute]))
  })

  test('the keyboard opens the menu of an entity IRI in the text', async () => {
    const user = userEvent.setup()
    const [alert] = withStatus('open')
    open(paths.alert(alert.id))
    store.update((state) => {
      Object.assign(state.alerts.find((a) => a.id === alert.id), { text: `Validation failed for ${alert.resource}.` })
      return state
    })
    const detail = await screen.findByRole('article', { name: `Alert ${alert.id}` })
    within(detail.querySelector('.alert-detail__text')).getByTitle(alert.resource).focus()
    await user.keyboard('{Shift>}{F10}{/Shift}')
    expect(within(screen.getByRole('menu')).getByRole('menuitem', { name: 'Go to the entity in the data explorer' })).toHaveFocus()
  })

  test('a vocabulary term in the text only offers copying its IRI', async () => {
    const [alert] = withStatus('open')
    const term = 'http://www.w3.org/2001/XMLSchema#double'
    open(paths.alert(alert.id))
    store.update((state) => {
      Object.assign(state.alerts.find((a) => a.id === alert.id), { text: `expected datatypes="${term}"` })
      return state
    })
    const detail = await screen.findByRole('article', { name: `Alert ${alert.id}` })
    const menu = (fireEvent.contextMenu(within(detail.querySelector('.alert-detail__text')).getByTitle(term), { clientX: 10, clientY: 10 }), screen.getByRole('menu'))
    expect(within(menu).getAllByRole('menuitem').map((m) => m.textContent)).toEqual(['Copy IRI'])
  })
})
