import { useState } from 'react'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Button, DataView, Dialog, ErrorState, StatusBadge, Tabs } from '../../src/ui/components'
import { RUN_STATUS, SEVERITY } from '../../src/ui/status'

describe('StatusBadge', () => {
  test.each(Object.entries(RUN_STATUS))('run status %s has a text label', (value, { label }) => {
    render(<StatusBadge kind="run" value={value} />)
    expect(screen.getByText(label)).toBeVisible()
  })

  test.each(Object.entries(SEVERITY))('severity %s has a text label', (value, { label }) => {
    render(<StatusBadge kind="severity" value={value} />)
    expect(screen.getByText(label)).toBeVisible()
  })

  test('unknown values still get a readable label', () => {
    render(<StatusBadge kind="run" value="some_new_state" />)
    expect(screen.getByText('Some new state')).toBeVisible()
  })

  test('the colour dot is hidden from assistive technology', () => {
    const { container } = render(<StatusBadge kind="health" value="ok" />)
    expect(container.querySelector('.badge__dot')).toHaveAttribute('aria-hidden', 'true')
  })
})

describe('Dialog', () => {
  function Harness({ busy = false }) {
    const [open, setOpen] = useState(false)
    return (
      <>
        <Button onClick={() => setOpen(true)}>Open</Button>
        <Dialog open={open} title="Confirm" busy={busy} onClose={() => setOpen(false)} footer={<Button>OK</Button>}>
          <input aria-label="Reason" />
        </Dialog>
      </>
    )
  }

  test('moves focus in, traps it, closes on Escape and returns focus', async () => {
    const user = userEvent.setup()
    render(<Harness />)
    const opener = screen.getByRole('button', { name: 'Open' })
    await user.click(opener)

    const dialog = screen.getByRole('dialog', { name: 'Confirm' })
    expect(dialog).toContainElement(document.activeElement)

    for (let i = 0; i < 5; i++) {
      await user.tab()
      expect(dialog).toContainElement(document.activeElement)
    }
    await user.tab({ shift: true })
    expect(dialog).toContainElement(document.activeElement)

    await user.keyboard('{Escape}')
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(opener).toHaveFocus()
  })

  test('Escape does not close while an action is in progress', async () => {
    const user = userEvent.setup()
    render(<Harness busy />)
    await user.click(screen.getByRole('button', { name: 'Open' }))
    await user.keyboard('{Escape}')
    expect(screen.getByRole('dialog')).toBeInTheDocument()
  })
})

describe('Tabs', () => {
  test('arrow keys move between tabs', async () => {
    const user = userEvent.setup()
    render(<Tabs label="Views" tabs={[{ id: 'a', label: 'First', content: 'A' }, { id: 'b', label: 'Second', content: 'B' }]} />)
    await user.click(screen.getByRole('tab', { name: 'First' }))
    await user.keyboard('{ArrowRight}')
    expect(screen.getByRole('tab', { name: 'Second' })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByRole('tabpanel')).toHaveTextContent('B')
  })
})

describe('Data states', () => {
  test('error state offers retry', async () => {
    const onRetry = vi.fn()
    render(<ErrorState error={{ message: 'Broker unavailable' }} onRetry={onRetry} />)
    expect(screen.getByRole('alert')).toHaveTextContent('Broker unavailable')
    await userEvent.click(screen.getByRole('button', { name: 'Retry' }))
    expect(onRetry).toHaveBeenCalledOnce()
  })

  test('DataView shows loading, error, empty and data', () => {
    const empty = <p>Nothing here</p>
    const view = (result) => (
      <DataView result={result} isEmpty={(d) => d.length === 0} empty={empty}>
        {(d) => <p>{d.length} items</p>}
      </DataView>
    )
    const { rerender } = render(view({ status: 'loading' }))
    expect(screen.getByRole('status')).toHaveTextContent('Loading')

    rerender(view({ status: 'error', error: { message: 'Down' }, retry: () => {} }))
    expect(screen.getByRole('alert')).toHaveTextContent('Down')

    rerender(view({ status: 'success', data: [] }))
    expect(screen.getByText('Nothing here')).toBeVisible()

    rerender(view({ status: 'success', data: [1, 2] }))
    expect(screen.getByText('2 items')).toBeVisible()
  })
})
