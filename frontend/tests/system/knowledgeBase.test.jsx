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

import { act, fireEvent, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { store } from '../../src/data/sources/mock'
import { renderApp, renderAppWith } from '../helpers'

const open = () => renderApp({ path: '/system', controls: { authEnabled: false } })
const kb = () => screen.findByRole('region', { name: 'Knowledge base' })
const row = (name) => document.querySelector(`tr[data-document="${CSS.escape(name)}"]`)
const names = () => [...document.querySelectorAll('tr[data-document]')].map((r) => r.dataset.document)
const markdown = (name, text) => new File([text], name, { type: 'text/markdown' })

function drop(files) {
  fireEvent.drop(screen.getByRole('group', { name: 'Add documents' }), { dataTransfer: { files } })
}

async function documentsLoaded() {
  await waitFor(() => expect(names().length).toBeGreaterThan(0))
}

afterEach(() => vi.useRealTimers())

describe('documents per pipeline', () => {
  test('switching pipelines lists that pipeline’s documents and explains each pipeline', async () => {
    const user = userEvent.setup()
    open()
    const region = await kb()
    await documentsLoaded()
    expect(within(region).getByRole('radio', { name: /Base pipeline/ })).toBeChecked()
    expect(within(region).getByText(/Indexes the text of each page\. Faster/)).toBeVisible()
    expect(within(region).getByText(/Section-aware\. Slower; better for documents with tables and diagrams/)).toBeVisible()
    expect(names()).toContain('PB-2200 hydraulic maintenance.pdf')
    const doc = row('PB-2200 hydraulic maintenance.pdf')
    expect(within(doc).getByText('Done')).toBeVisible()
    expect(within(doc).getByText('Hydraulic system maintenance for press brakes 01 and 02.')).toBeVisible()
    expect(doc.querySelector('time')).toHaveAttribute('dateTime')

    await user.click(within(region).getByRole('radio', { name: /Structured pipeline/ }))
    await waitFor(() => expect(names()).toContain('PB-2200 spare parts catalogue.pdf'))
    expect(names()).not.toContain('PB-2200 hydraulic maintenance.pdf')
    expect(within(region).getByRole('table', { name: 'Documents in the structured pipeline' })).toBeVisible()
  })

  test('a pipeline without documents says so', async () => {
    const user = userEvent.setup()
    renderAppWith(() => { store.update((s) => { s.kb.documents = s.kb.documents.filter((d) => d.pipeline !== 'structured'); return s }) }, { path: '/system', controls: { authEnabled: false } })
    const region = await kb()
    await documentsLoaded()
    await user.click(within(region).getByRole('radio', { name: /Structured pipeline/ }))
    expect(await within(region).findByText('No documents have been ingested yet.')).toBeVisible()
  })
})

describe('upload', () => {
  test('a dropped document appears with progress and shows as done with its chunks', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    open()
    await kb()
    await documentsLoaded()
    drop([markdown('Torque table.md', '# Torque values\nGauge screws 12 Nm.\n# Lubrication\nGrease the ball screw monthly.')])
    await waitFor(() => expect(row('Torque table.md')).not.toBeNull())
    await act(() => vi.advanceTimersByTimeAsync(2100))
    await waitFor(() => expect(within(row('Torque table.md')).getByText('Processing')).toBeVisible())
    expect(within(row('Torque table.md')).getByRole('progressbar', { name: 'Ingestion progress of Torque table.md' })).toBeVisible()
    expect(within(row('Torque table.md')).getByText(/\d+ %/)).toBeVisible()
    await act(() => vi.advanceTimersByTimeAsync(4000))
    await waitFor(() => expect(within(row('Torque table.md')).getByText('Done')).toBeVisible())
    expect(within(row('Torque table.md')).getByRole('cell', { name: '2' })).toBeVisible()
    expect(within(row('Torque table.md')).queryByRole('progressbar')).not.toBeInTheDocument()
  })

  test('documents can also be chosen with the file picker', async () => {
    const user = userEvent.setup()
    open()
    const region = await kb()
    await documentsLoaded()
    await user.upload(within(region).getByLabelText('Or choose files'), new File(['%PDF-1.4'], 'Valve datasheet.pdf', { type: 'application/pdf' }))
    await waitFor(() => expect(row('Valve datasheet.pdf')).not.toBeNull())
    expect(store.get().kb.documents.find((d) => d.name === 'Valve datasheet.pdf').pipeline).toBe('base')
  })

  test('unsupported types and files above the size limit are refused with the reason, and nothing is uploaded', async () => {
    open()
    const region = await kb()
    await documentsLoaded()
    const big = new File(['x'], 'Large manual.pdf', { type: 'application/pdf' })
    Object.defineProperty(big, 'size', { value: 51 * 1024 * 1024 })
    drop([new File(['x'], 'photo.png', { type: 'image/png' }), big])
    const alert = await within(region).findByRole('alert')
    expect(alert).toHaveTextContent('photo.png was refused: only PDF, Word (.docx) and Markdown documents can be added.')
    expect(alert).toHaveTextContent('Large manual.pdf was refused: the file is larger than 50 MB.')
    expect(Object.keys(store.get().kb.jobs)).toHaveLength(0)
    expect(names()).not.toContain('photo.png')
  })

  test('a failed ingestion shows the reason and the document can be removed', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    open()
    await kb()
    await documentsLoaded()
    drop([new File(['%PDF'], 'corrupt-manual.pdf', { type: 'application/pdf' })])
    await waitFor(() => expect(row('corrupt-manual.pdf')).not.toBeNull())
    await act(() => vi.advanceTimersByTimeAsync(5000))
    await waitFor(() => expect(within(row('corrupt-manual.pdf')).getByText('Failed')).toBeVisible())
    expect(within(row('corrupt-manual.pdf')).getByText(/could not be parsed/)).toBeVisible()
    await user.click(within(row('corrupt-manual.pdf')).getByRole('button', { name: 'Delete corrupt-manual.pdf' }))
    await user.click(within(screen.getByRole('dialog', { name: 'Delete corrupt-manual.pdf?' })).getByRole('button', { name: 'Delete' }))
    await waitFor(() => expect(row('corrupt-manual.pdf')).toBeNull())
  })
})

describe('describe and delete', () => {
  test('edit and save a description', async () => {
    const user = userEvent.setup()
    open()
    await kb()
    await documentsLoaded()
    const doc = row('Shift handover checklist.md')
    await user.click(within(doc).getByRole('button', { name: 'Edit description of Shift handover checklist.md' }))
    const field = within(doc).getByLabelText('Description of Shift handover checklist.md')
    await user.clear(field)
    await user.type(field, 'Checks per line and shift.')
    await user.click(within(doc).getByRole('button', { name: 'Save description' }))
    expect(await within(row('Shift handover checklist.md')).findByText('Checks per line and shift.')).toBeVisible()
  })

  test('delete a document after confirmation', async () => {
    const user = userEvent.setup()
    open()
    await kb()
    await documentsLoaded()
    await user.click(within(row('Shift handover checklist.md')).getByRole('button', { name: 'Delete Shift handover checklist.md' }))
    const dialog = screen.getByRole('dialog', { name: 'Delete Shift handover checklist.md?' })
    expect(dialog).toHaveTextContent('removed from the base pipeline')
    expect(names()).toContain('Shift handover checklist.md')
    await user.click(within(dialog).getByRole('button', { name: 'Delete' }))
    await waitFor(() => expect(names()).not.toContain('Shift handover checklist.md'))
  })
})

describe('test retrieval', () => {
  test('ranked passages with source document, page or section, and score', async () => {
    const user = userEvent.setup()
    open()
    const region = await kb()
    await user.type(within(region).getByLabelText('Question'), 'burr protective window')
    await user.click(within(region).getByRole('button', { name: 'Run test query' }))
    const list = await within(region).findByRole('list', { name: 'Retrieved passages' })
    const items = within(list).getAllByRole('listitem')
    expect(items.length).toBeGreaterThan(1)
    expect(items[0]).toHaveTextContent('LC-3015 operating manual.pdf')
    expect(items[0]).toHaveTextContent(/page \d+/)
    expect(items[0]).toHaveTextContent(/Score \d\.\d\d/)
    const scores = items.map((i) => Number(i.textContent.match(/Score (\d\.\d\d)/)[1]))
    expect(scores).toEqual([...scores].sort((a, b) => b - a))
  })

  test('no passages found', async () => {
    const user = userEvent.setup()
    open()
    const region = await kb()
    await user.type(within(region).getByLabelText('Question'), 'xylophone zeppelin')
    await user.click(within(region).getByRole('button', { name: 'Run test query' }))
    expect(await within(region).findByText('No passages were found.')).toBeVisible()
  })
})
