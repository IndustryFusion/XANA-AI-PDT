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
import { reduceRunEvent } from '../../src/data/useRun'
import { writeControls } from '../../src/data/sources/mock/controls'
import { paths } from '../../src/app/router'
import StepFeed from '../../src/features/incidents/StepFeed'
import { DecisionCard, HypothesisList } from '../../src/features/incidents/Analysis'
import { OutcomePanel } from '../../src/features/incidents/panels'
import { addRun, findRun, renderApp, renderAppWith, renderWithRouter } from '../helpers'
import { KNOWLEDGE_BASE_ENABLED } from '../../src/data/interface'

const controls = { authEnabled: false, speed: 50 }
const openRun = (runId, extra = {}) => renderApp({ path: paths.run(runId), controls: { ...controls, ...extra } })
/** Arranges a run with `addRun(options)` and opens it. */
const openNew = (options) => renderAppWith(() => addRun(options), { controls })
const panel = (name) => screen.findByRole('region', { name })
const confirm = ['confirmResolution', { confirmed: true }]

describe('useRun reducer', () => {
  const run = { runId: 'r', status: 'running', data: {}, steps: [], escalation: null }

  test('applies steps and status changes to the snapshot', () => {
    let s = reduceRunEvent({ phase: 'loading', run: null }, { type: 'snapshot', run })
    s = reduceRunEvent(s, { type: 'step', node: 'observe', output: { summary: 'x' }, at: '2026-11-02T10:00:00Z' })
    s = reduceRunEvent(s, { type: 'status', status: 'awaiting_input', data: { question: 'q' }, summary: { incidentId: 7 } })
    expect(s.run).toMatchObject({ status: 'awaiting_input', incidentId: 7, data: { question: 'q' } })
    expect(s.run.steps).toHaveLength(1)
  })

  test('shows reconnecting, and the next snapshot replaces the state', () => {
    let s = reduceRunEvent({ phase: 'loading', run: null }, { type: 'snapshot', run })
    s = reduceRunEvent(s, { type: 'connection', state: 'reconnecting' })
    expect(s.connection).toBe('reconnecting')
    const fresh = { ...run, status: 'awaiting_machine_builder', steps: [{ node: 'message', output: {}, at: 'x' }] }
    s = reduceRunEvent(s, { type: 'snapshot', run: fresh })
    expect(s).toEqual({ phase: 'ready', run: fresh, connection: 'live', error: null })
  })
})

describe('run header', () => {
  test('an escalated run shows incident number, escalation reference, machine, issue and status', async () => {
    openRun('run-1003')
    expect(await screen.findByRole('heading', { name: 'Incident #43', level: 2 })).toBeVisible()
    expect(screen.getAllByText('ESC-2047')[0]).toBeVisible()
    expect(screen.getByRole('link', { name: 'chiller-01' })).toBeVisible()
    expect(screen.getByText('Coolant temperature above set point, laser source derating', { selector: '.run-header__issue' })).toBeVisible()
    expect(screen.getAllByText('Awaiting machine builder')[0]).toBeVisible()
  })
})

describe('live step feed', () => {
  test('steps stream in at the end with a progress indication while running', async () => {
    openRun('run-1001')
    const feed = await panel('Agent steps')
    expect(within(feed).getByRole('status')).toHaveTextContent('The agent is working…')
    await within(feed).findByText('Validate')
    const kinds = within(feed).getAllByRole('listitem').filter((li) => li.classList.contains('step')).map((li) => li.dataset.node)
    expect(kinds.filter((k) => k !== 'retrieve_documents').slice(0, 4)).toEqual(['observe', 'hypothesize', 'retrieve_similar_incidents', 'validate'])
    expect(kinds.includes('retrieve_documents')).toBe(KNOWLEDGE_BASE_ENABLED)
    await within(feed).findByText('Decide')
    await waitFor(() => expect(within(feed).queryByRole('status')).not.toBeInTheDocument())
  })

  const steps = [
    { node: 'observe', input: null, output: { summary: 'Values read', sources: [{ source: 'Broker', status: 'ok' }], partialData: false }, at: '2026-11-02T10:00:00Z' },
    { node: 'thermal_imaging', input: null, output: { hotspot: 'Valve block', maxTemperature: 71 }, at: '2026-11-02T10:01:00Z' },
    { node: 'policy_check', input: null, output: { tier: 'Tier 1 · machine data', recipient: 'Formwerk', sent: ['Machine attributes'], withheld: ['Oil analysis report'], decision: 'Items beyond the tier wait.' }, at: '2026-11-02T10:02:00Z' },
  ]

  test('unknown step kinds are shown generically with kind and output', () => {
    renderWithRouter(<StepFeed steps={steps} running={false} />)
    expect(screen.getByText('Thermal imaging')).toBeVisible()
    expect(screen.getByText('Hotspot: Valve block · Max temperature: 71')).toBeVisible()
  })

  test('expanding a step shows its output as labelled fields', async () => {
    renderWithRouter(<StepFeed steps={steps} running={false} />)
    const toggle = screen.getByRole('button', { name: 'Show details of Observe step' })
    await userEvent.click(toggle)
    expect(toggle).toHaveAttribute('aria-expanded', 'true')
    const details = screen.getByRole('region', { name: 'Output of Observe step' })
    expect(within(details).getByText('Summary', { selector: 'dt' }).nextSibling).toHaveTextContent('Values read')
    expect(within(details).getByText('Partial data', { selector: 'dt' }).nextSibling).toHaveTextContent('No')
  })

  test('a policy check lists what was sent, the tier and what was withheld', () => {
    renderWithRouter(<StepFeed steps={steps} running={false} />)
    const item = screen.getByText('Policy check').closest('li')
    const field = (label) => within(item).getByText(label, { selector: 'dt' }).nextSibling
    expect(field('Tier')).toHaveTextContent('Tier 1 · machine data')
    expect(field('Sent')).toHaveTextContent('Machine attributes')
    expect(field('Withheld')).toHaveTextContent('Oil analysis report')
  })
})

describe('hypotheses and decision', () => {
  const at = '2026-11-02T10:00:00Z'
  const proposed = { node: 'hypothesize', output: { hypotheses: [{ id: 'a', title: 'Valve', confidence: 0.7, evidence: ['e1'] }, { id: 'b', title: 'Pump', confidence: 0.5, evidence: [] }] }, at }
  const validated = { node: 'validate', output: { hypotheses: [{ id: 'a', title: 'Valve', confidence: 0.3, evidence: ['e1'], validation: 'Ruled out by idle pressure' }, { id: 'b', title: 'Pump', confidence: 0.84, evidence: ['Running hours'], validation: 'Delivery 82 %' }] }, at }

  test('validated hypotheses replace the proposal, ordered by confidence with notes', () => {
    const { rerender } = renderWithRouter(<HypothesisList steps={[proposed]} />)
    expect(screen.getByRole('heading', { name: 'Hypotheses (not validated yet)' })).toBeVisible()
    rerender(<HypothesisList steps={[proposed, validated]} />)
    expect(screen.getByRole('heading', { name: 'Validated hypotheses' })).toBeVisible()
    const items = screen.getAllByRole('listitem').filter((li) => li.classList.contains('hypothesis'))
    expect(items.map((li) => li.querySelector('strong').textContent)).toEqual(['Pump', 'Valve'])
    expect(items[0]).toHaveTextContent('84%')
    expect(items[0]).toHaveTextContent('Running hours')
    expect(items[0]).toHaveTextContent('Delivery 82 %')
  })

  test('hypotheses are colour-coded by confidence: high green, medium amber, low red', () => {
    renderWithRouter(<HypothesisList steps={[proposed, validated]} />)
    const items = screen.getAllByRole('listitem').filter((li) => li.classList.contains('hypothesis'))
    expect(items[0]).toHaveClass('toned--success')
    expect(within(items[0]).getByText('High')).toBeVisible()
    expect(items[1]).toHaveClass('toned--danger')
    expect(within(items[1]).getByText('Low')).toBeVisible()
  })

  test('the decision card shows root cause, recommended action and confidence', () => {
    renderWithRouter(<DecisionCard steps={[{ node: 'decide', output: { rootCause: 'Worn pump', recommendedAction: 'Replace pump', confidence: 0.84 }, at }]} />)
    const card = screen.getByRole('region', { name: 'Decision' })
    expect(card).toHaveTextContent('Worn pump')
    expect(card).toHaveTextContent('Replace pump')
    expect(card).toHaveTextContent('84%')
    expect(card).toHaveClass('toned--success')
    expect(within(card).getByText('High')).toBeVisible()
  })

  test('no decision card while confidence is below the threshold', () => {
    renderWithRouter(<DecisionCard steps={[{ node: 'decide', output: { rootCause: null, confidence: 0.4 }, at }]} />)
    expect(screen.queryByRole('region', { name: 'Decision' })).not.toBeInTheDocument()
  })
})

describe('state panels', () => {
  test('clarification: question, confidence, text and files; submitting resumes the run', async () => {
    const user = userEvent.setup()
    openRun('run-1002')
    const p = await panel('The agent needs more information')
    expect(p).toHaveTextContent('Does the pressure drop on every bend')
    expect(p).toHaveTextContent('48%')
    expect(within(p).getByLabelText('Attach files (optional)')).toBeVisible()
    expect(within(p).getByRole('button', { name: 'Escalate to machine builder…' })).toBeVisible()
    await user.type(within(p).getByLabelText('Your clarification'), 'Only on parts longer than 2 m.')
    await user.click(within(p).getByRole('button', { name: 'Submit clarification' }))
    expect(await screen.findAllByText('Running')).not.toHaveLength(0)
    const feed = await panel('Agent steps')
    expect(await within(feed).findByText(/Operator clarified: “Only on parts longer than 2 m.”/)).toBeVisible()
    expect(await panel('Confirm the proposed resolution')).toBeVisible()
  })

  test('confirm resolution shows root cause, action and the rejected ones; rejecting starts a new round', async () => {
    const user = userEvent.setup()
    openRun('run-1004')
    const p = await panel('Confirm the proposed resolution')
    expect(p).toHaveTextContent('Worn electrode in the left spray gun')
    expect(p).toHaveTextContent('Replace the electrode')
    await user.click(within(p).getByRole('button', { name: 'Reject…' }))
    await user.click(within(p).getByRole('button', { name: 'Submit rejection' }))
    expect(within(p).getByText('Give a reason for the rejection.')).toBeVisible()
    await user.type(within(p).getByLabelText('Reason for rejecting'), 'Electrode replaced yesterday.')
    await user.click(within(p).getByRole('button', { name: 'Submit rejection' }))
    await waitFor(() => expect(screen.queryByRole('region', { name: 'Confirm the proposed resolution' })).not.toBeInTheDocument())
    const next = await panel('Confirm the proposed resolution')
    const rejected = within(next).getByRole('region', { name: 'Previously rejected resolutions' })
    expect(rejected).toHaveTextContent('Worn electrode in the left spray gun')
    expect(rejected).toHaveTextContent('Electrode replaced yesterday.')
    expect(within(next).getByText('Powder hose partly blocked')).toBeVisible()
  })

  test('diagnostics show the agent steps first, then the hypotheses, then the decision', async () => {
    openRun('run-1004')
    await panel('Confirm the proposed resolution')
    const headings = screen.getAllByRole('heading', { level: 3 }).map((h) => h.textContent)
    const order = ['Agent steps', 'Validated hypotheses', 'Decision'].map((t) => headings.indexOf(t))
    expect(order.every((i) => i >= 0)).toBe(true)
    expect([...order].sort((a, b) => a - b)).toEqual(order)
  })

  test('while a resolution waits for confirmation the operator can escalate to the machine builder', async () => {
    const user = userEvent.setup()
    openRun('run-1004')
    const p = await panel('Confirm the proposed resolution')
    await user.click(within(p).getByRole('button', { name: 'Escalate to machine builder…' }))
    const dialog = await screen.findByRole('dialog', { name: 'Escalate to the machine builder' })
    await user.click(await within(dialog).findByRole('button', { name: 'Escalate' }))
    expect(await screen.findByText(/^Escalated as/)).toBeVisible()
    expect(screen.queryByRole('region', { name: 'Confirm the proposed resolution' })).not.toBeInTheDocument()
  })

  test('recommendation review shows summary and ordered actions; resolved completes the run', async () => {
    const user = userEvent.setup()
    openNew({ scenario: 'mb_recommendation', machine: 'chiller-01', actions: [['escalate']] })
    const p = await panel('Recommendation from CoolFlow Process Cooling')
    expect(p).toHaveTextContent('Condenser fouling')
    expect(within(p).getAllByRole('listitem').map((li) => li.textContent)).toEqual([
      'Clean the condenser with compressed air', 'Check the condenser fan direction', 'Lower the set point hysteresis to 1 K', 'Monitor coolant temperature for one shift',
    ])
    expect(within(p).getByRole('button', { name: 'Still failing' })).toBeVisible()
    expect(within(p).getByRole('button', { name: 'Escalate to direct contact' })).toBeVisible()
    await user.click(within(p).getByRole('button', { name: 'Resolved' }))
    expect(await panel('Completed')).toBeVisible()
  })

  test('operator approval shows requested, automatically sent and approval-needing data', async () => {
    const user = userEvent.setup()
    openNew({ scenario: 'request_beyond_tier', machine: 'press-brake-02', actions: [['escalate']] })
    const runId = window.location.pathname.split('/').pop()
    const p = await panel('Data request needs your approval')
    expect(within(p).getByRole('region', { name: 'Within the sharing tier' })).toHaveTextContent('Hydraulic pressure and oil temperature, last 24 h')
    expect(within(p).getByRole('region', { name: 'Needs approval' })).toHaveTextContent('Hydraulic oil analysis report')
    await user.type(within(p).getByLabelText('Note to the machine builder (optional)'), 'Only for this incident.')
    await user.click(within(p).getByRole('button', { name: 'Decline' }))
    await waitFor(() => expect(findRun(runId).status).toBe('awaiting_machine_builder'))
  })

  test('a failing action keeps the panel and the input and shows the reason', async () => {
    const user = userEvent.setup()
    openRun('run-1002')
    const p = await panel('The agent needs more information')
    await user.type(within(p).getByLabelText('Your clarification'), 'Long parts only')
    writeControls({ failure: { runs: 'unavailable' } })
    await user.click(within(p).getByRole('button', { name: 'Submit clarification' }))
    expect(await within(p).findByRole('alert')).toHaveTextContent('runs is unavailable')
    expect(within(p).getByLabelText('Your clarification')).toHaveValue('Long parts only')
  })
})

describe('escalation pre-flight', () => {
  test('shows recipient, data and tier; escalates only after confirmation', async () => {
    const user = userEvent.setup()
    openRun('run-1002')
    await user.click(await screen.findByRole('button', { name: 'Escalate to machine builder…' }))
    const dialog = await screen.findByRole('dialog', { name: 'Escalate to the machine builder' })
    expect(await within(dialog).findByText('Formwerk Press Technology')).toBeVisible()
    expect(dialog).toHaveTextContent('minimal · machine entity only')
    expect(dialog).toHaveTextContent('Current sensor values')
    expect(findRun('run-1002').status).toBe('awaiting_input')
    await user.click(within(dialog).getByRole('button', { name: 'Escalate' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(findRun('run-1002').status).toBe('awaiting_machine_builder')
  })

  test('when escalation is not possible the dialog explains why and offers no confirm', async () => {
    const user = userEvent.setup()
    openRun('run-1002', { connection: 'disconnected' })
    await user.click(await screen.findByRole('button', { name: 'Escalate to machine builder…' }))
    const dialog = await screen.findByRole('dialog', { name: 'Escalate to the machine builder' })
    expect(await within(dialog).findByText('Escalation is not possible.')).toBeVisible()
    expect(dialog).toHaveTextContent('The dataspace is not connected')
    expect(within(dialog).queryByRole('button', { name: 'Escalate' })).not.toBeInTheDocument()
    expect(within(dialog).getByRole('button', { name: 'Close' })).toBeVisible()
  })
})

describe('outcomes, stop, reopen and archive', () => {
  test('completed shows the final decision, that the incident was logged, and archive', async () => {
    openNew({ scenario: 'happy_path', actions: [confirm] })
    const p = await panel('Completed')
    expect(p).toHaveTextContent('Protective window contaminated by spatter')
    expect(p).toHaveTextContent(/The incident was logged as incident #\d+/)
    expect(within(p).getByRole('button', { name: 'Archive…' })).toBeVisible()
    expect(within(p).queryByRole('button', { name: 'Reopen…' })).not.toBeInTheDocument()
  })

  test('failed shows the error and archive; reopen only when a conversation exists', async () => {
    openNew({ scenario: 'failure' })
    const p = await panel('The run failed')
    expect(p).toHaveTextContent('The language model did not respond')
    expect(within(p).queryByRole('button', { name: 'Reopen…' })).not.toBeInTheDocument()

    const withConversation = { runId: 'r', status: 'failed', data: { error: 'Gateway timeout' }, escalation: { ref: 'ESC-1' }, reopenable: true }
    renderWithRouter(<OutcomePanel run={withConversation} />)
    expect(screen.getAllByRole('button', { name: 'Reopen…' })).toHaveLength(1)
  })

  test('a close that has not reached the machine builder says so and why', async () => {
    const data = { by: 'operator', reason: 'Done', closePending: true, closeProblem: 'only the machine builder can close it now' }
    renderWithRouter(<OutcomePanel run={{ runId: 'r', status: 'stopped', data, escalation: { ref: 'E' }, reopenable: true }} />)
    expect(await screen.findByText(/Not told yet that this is closed: only the machine builder can close it now/)).toBeVisible()
  })

  test('closed by the machine builder shows outcome and reason; not reopenable when final', async () => {
    openNew({ scenario: 'mb_closes', machine: 'extractor-01', actions: [['escalate'], ['refreshConversationStatus']] })
    const p = await panel('Closed by the machine builder')
    expect(p).toHaveTextContent('Resolved')
    expect(p).toHaveTextContent('Our technician replaced the worn part on site')
    expect(within(p).getByRole('button', { name: 'Reopen…' })).toBeVisible()

    renderWithRouter(<OutcomePanel run={{ runId: 'r', status: 'mb_closed', data: { outcome: 'escalated', reason: 'Handed to service' }, escalation: { ref: 'E' }, reopenable: false }} />)
    expect(screen.getByText('This run cannot be reopened.')).toBeVisible()
  })

  test('stop after confirmation, reopen continues the conversation, archive moves it to the history', async () => {
    const user = userEvent.setup()
    openNew({ scenario: 'stop_and_reopen', machine: 'deburring-01', issue: 'Stop me', actions: [['escalate']] })
    await user.click(await screen.findByRole('button', { name: 'Stop run…' }))
    await user.click(within(screen.getByRole('dialog', { name: 'Stop this run?' })).getByRole('button', { name: 'Stop run' }))
    const stopped = await panel('Stopped')
    expect(stopped).toHaveTextContent('Stopped by the operator')

    await user.click(within(stopped).getByRole('button', { name: 'Reopen…' }))
    await user.click(within(screen.getByRole('dialog', { name: 'Reopen this run?' })).getByRole('button', { name: 'Reopen' }))
    expect(await panel('Waiting for SurfaceTec Finishing')).toBeVisible()
    expect(await screen.findByText('Conversation reopened by the operator.')).toBeVisible()

    await user.click(screen.getByRole('button', { name: 'Stop run…' }))
    await user.click(within(screen.getByRole('dialog', { name: 'Stop this run?' })).getByRole('button', { name: 'Stop run' }))
    await user.click(within(await panel('Stopped')).getByRole('button', { name: 'Archive…' }))
    await user.click(within(screen.getByRole('dialog', { name: 'Archive this run?' })).getByRole('button', { name: 'Archive' }))
    await waitFor(() => expect(window.location.pathname).toBe('/incidents'))
    const list = await screen.findByRole('region', { name: 'Open runs' })
    await waitFor(() => expect(within(list).queryByText('Stop me')).not.toBeInTheDocument())
    await user.click(screen.getByRole('link', { name: 'Incident history' }))
    expect(await screen.findByRole('link', { name: /Stop me/ })).toBeVisible()
  })
})

describe('delivery of an escalation', () => {
  test('is read from the data source, as the stream does not carry it, and shows a failure', async () => {
    const { runs } = await import('../../src/data')
    const { WaitingPanel } = await import('../../src/features/incidents/panels')
    const { render, screen: view } = await import('@testing-library/react')
    const spy = vi.spyOn(runs, 'getOutboxStatus').mockResolvedValue([
      { messageId: 'm1', status: 'delivered', kind: 'files' },
      { messageId: 'm2', status: 'failed', kind: 'request', error: 'The receiver is away' },
    ])
    render(<WaitingPanel run={{ runId: 'r', escalationRef: 'ESC-1', data: { builder: 'B' }, outbox: [] }} />)
    expect(await view.findByText('Machine data')).toBeVisible()
    expect(view.getByText('The receiver is away')).toBeVisible()
    expect(spy).toHaveBeenCalledWith('r')
    spy.mockRestore()
  })
})
