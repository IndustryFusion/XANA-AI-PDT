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

import { useState } from 'react'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ConfidenceMeter, ConfirmDialog, FileAttachments, StructuredFields } from '../../src/ui/structured'
import { Button } from '../../src/ui/components'
import { formatAge, humanize } from '../../src/ui/format'

test('ConfidenceMeter shows the confidence as percentage text', () => {
  render(<ConfidenceMeter value={0.724} />)
  expect(screen.getByText('72%')).toBeVisible()
  expect(screen.getByText('Confidence')).toBeVisible()
})

test.each([
  [0.86, 'High', 'success'],
  [0.7, 'High', 'success'],
  [0.69, 'Medium', 'attention'],
  [0.4, 'Medium', 'attention'],
  [0.39, 'Low', 'danger'],
  [0, 'Low', 'danger'],
])('ConfidenceMeter %s is coloured as %s with the level as text', (value, level, tone) => {
  const { container } = render(<ConfidenceMeter value={value} />)
  expect(screen.getByText(level)).toBeVisible()
  expect(container.firstChild).toHaveClass(`confidence--${tone}`)
})

test('StructuredFields renders labelled fields, lists and nested objects', () => {
  render(<StructuredFields value={{ rootCause: 'Worn valve', confidence: 0.86, partialData: false, sources: [{ source: 'Broker', status: 'ok' }], sent: ['A', 'B'], note: null }} />)
  const term = (label) => screen.getByText(label, { selector: 'dt' })
  expect(term('Root cause').nextSibling).toHaveTextContent('Worn valve')
  expect(term('Confidence').nextSibling).toHaveTextContent('86%')
  expect(term('Partial data').nextSibling).toHaveTextContent('No')
  expect(within(term('Sent').nextSibling).getAllByRole('listitem')).toHaveLength(2)
  expect(term('Source')).toBeInTheDocument()
  expect(term('Note').nextSibling).toHaveTextContent('None')
  expect(document.body.textContent).not.toContain('{')
})

test('humanize and formatAge', () => {
  expect(humanize('recommendedAction')).toBe('Recommended action')
  expect(humanize('retrieve_similar_incidents')).toBe('Retrieve similar incidents')
  const now = Date.parse('2026-11-02T12:00:00Z')
  expect(formatAge('2026-11-02T11:56:00Z', now)).toBe('4 min')
  expect(formatAge('2026-11-02T08:50:00Z', now)).toBe('3 h 10 min')
  expect(formatAge('2026-10-30T12:00:00Z', now)).toBe('3 d')
})

describe('ConfirmDialog', () => {
  function Harness({ onConfirm }) {
    const [open, setOpen] = useState(false)
    return (
      <>
        <Button onClick={() => setOpen(true)}>Stop run</Button>
        <ConfirmDialog open={open} title="Stop this run?" confirmLabel="Stop run" onConfirm={onConfirm} onClose={() => setOpen(false)}>
          <p>The agent stops working on it.</p>
        </ConfirmDialog>
      </>
    )
  }

  test('confirm runs the action and closes', async () => {
    const onConfirm = vi.fn().mockResolvedValue()
    render(<Harness onConfirm={onConfirm} />)
    await userEvent.click(screen.getByRole('button', { name: 'Stop run' }))
    await userEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Stop run' }))
    expect(onConfirm).toHaveBeenCalledOnce()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  test('cancel closes without the action', async () => {
    const onConfirm = vi.fn()
    render(<Harness onConfirm={onConfirm} />)
    await userEvent.click(screen.getByRole('button', { name: 'Stop run' }))
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(onConfirm).not.toHaveBeenCalled()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  test('a failing action keeps the dialog open with the reason', async () => {
    render(<Harness onConfirm={() => Promise.reject(new Error('The run already finished.'))} />)
    await userEvent.click(screen.getByRole('button', { name: 'Stop run' }))
    await userEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Stop run' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('The run already finished.')
    expect(screen.getByRole('dialog')).toBeInTheDocument()
  })
})

describe('FileAttachments', () => {
  function Harness() {
    const [files, setFiles] = useState([])
    return <FileAttachments files={files} onChange={setFiles} />
  }
  const file = (name, size, type = 'image/png') => {
    const f = new File(['x'], name, { type })
    Object.defineProperty(f, 'size', { value: size })
    return f
  }

  test('accepts files within the limits and reads them', async () => {
    render(<Harness />)
    await userEvent.upload(screen.getByLabelText('Attach files (optional)'), [file('nozzle.png', 2048)])
    const list = await screen.findByRole('list', { name: 'Attached files' })
    expect(list).toHaveTextContent('nozzle.png')
    await userEvent.click(screen.getByRole('button', { name: 'Remove nozzle.png' }))
    expect(screen.queryByRole('list', { name: 'Attached files' })).not.toBeInTheDocument()
  })

  test('rejects oversize files and more than five files', async () => {
    render(<Harness />)
    const input = screen.getByLabelText('Attach files (optional)')
    await userEvent.upload(input, [file('huge.pdf', 11 * 1024 * 1024, 'application/pdf')])
    expect(await screen.findByRole('alert')).toHaveTextContent('huge.pdf is larger than 10 MB.')
    expect(screen.queryByRole('list', { name: 'Attached files' })).not.toBeInTheDocument()

    await userEvent.upload(input, Array.from({ length: 6 }, (_, i) => file(`photo-${i}.png`, 100)))
    expect(await screen.findByText(/photo-5.png was not added/)).toBeVisible()
    expect(screen.queryByText('huge.pdf is larger than 10 MB.')).not.toBeInTheDocument()
    expect(within(screen.getByRole('list', { name: 'Attached files' })).getAllByRole('listitem')).toHaveLength(5)
  })
})
