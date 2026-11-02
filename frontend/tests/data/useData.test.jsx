import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useData } from '../../src/data/useData'
import { writeControls } from '../../src/data/sources/mock/controls'

function Probe({ area, op, label }) {
  const r = useData(area, op)
  return (
    <section aria-label={label}>
      <span>{r.status}</span>
      {r.status === 'error' && <button onClick={r.retry}>retry {label}</button>}
    </section>
  )
}

test('a failing area does not affect another area', async () => {
  writeControls({ failure: { alerts: 'unavailable' } })
  render(
    <>
      <Probe area="alerts" op="countAlerts" label="alerts" />
      <Probe area="entities" op="getStats" label="entities" />
    </>,
  )
  await waitFor(() => expect(screen.getByRole('region', { name: 'alerts' })).toHaveTextContent('error'))
  expect(screen.getByRole('region', { name: 'entities' })).toHaveTextContent('success')
})

test('retry loads again once the area has recovered', async () => {
  writeControls({ failure: { alerts: 'unavailable' } })
  render(<Probe area="alerts" op="countAlerts" label="alerts" />)
  await screen.findByRole('button', { name: 'retry alerts' })
  writeControls({ failure: {} })
  await userEvent.click(screen.getByRole('button', { name: 'retry alerts' }))
  await waitFor(() => expect(screen.getByRole('region', { name: 'alerts' })).toHaveTextContent('success'))
})
