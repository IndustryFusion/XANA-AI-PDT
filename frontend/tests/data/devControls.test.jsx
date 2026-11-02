import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { readControls } from '../../src/data/sources/mock/controls'
import { engine } from '../../src/data/sources/mock'
import { renderApp } from '../helpers'

async function openControls(user) {
  await user.click(await screen.findByRole('button', { name: 'Mock data controls' }))
  return screen.getByRole('dialog', { name: 'Mock data controls' })
}

test('scenario and playback speed are chosen in the controls and stored', async () => {
  const user = userEvent.setup()
  renderApp({ controls: { authEnabled: false } })
  const dialog = await openControls(user)
  const scenario = within(dialog).getByLabelText('Scenario for the next started run')
  expect(within(scenario).getAllByRole('option')).toHaveLength(11)
  await user.selectOptions(scenario, 'degraded_data')
  expect(dialog).toHaveTextContent('One data source is unavailable')
  await user.selectOptions(within(dialog).getByLabelText('Playback speed of simulated runs'), '10')
  expect(readControls()).toMatchObject({ scenario: 'degraded_data', speed: 10 })
})

test('the live connection of an open run can be interrupted and restored', async () => {
  const user = userEvent.setup()
  renderApp({ controls: { authEnabled: false } })
  const dialog = await openControls(user)
  await user.click(within(dialog).getByRole('button', { name: 'Interrupt connection of run-1003' }))
  expect(engine.isInterrupted('run-1003')).toBe(true)
  await user.click(within(dialog).getByRole('button', { name: 'Restore connection of run-1003' }))
  await waitFor(() => expect(engine.isInterrupted('run-1003')).toBe(false))
})

test('live entity updates and occasional new alerts are switched in the controls', async () => {
  const user = userEvent.setup()
  renderApp({ controls: { authEnabled: false } })
  const dialog = await openControls(user)
  await user.selectOptions(within(dialog).getByLabelText('Live entity updates'), 'unavailable')
  await user.click(within(dialog).getByLabelText('Raise new alerts occasionally while the Alerts area is open'))
  expect(readControls()).toMatchObject({ liveUpdates: 'unavailable', newAlerts: false })
})
