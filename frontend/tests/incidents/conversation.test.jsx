import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { writeControls } from '../../src/data/sources/mock/controls'
import { paths } from '../../src/app/router'
import { MessageThread } from '../../src/features/incidents/Conversation'
import { addRun, findRun, renderApp, renderAppWith, renderWithRouter } from '../helpers'

const controls = { authEnabled: false, speed: 50 }
const openRun = (runId) => renderApp({ path: paths.run(runId), controls })
const openNew = (options) => renderAppWith(() => addRun(options), { controls })
const thread = () => screen.findByRole('region', { name: 'Message thread' })
const actOptions = () => within(screen.getByLabelText('Act')).getAllByRole('option').map((o) => o.textContent)
const escalate = ['escalate']
const act = (a, extra = {}) => ['sendConversationAct', { act: a, ...extra }]

describe('conversation view after escalation', () => {
  test('escalating switches to the conversation; diagnostics stay available', async () => {
    const user = userEvent.setup()
    openRun('run-1002')
    expect(await screen.findByRole('region', { name: 'Agent steps' })).toBeVisible()
    expect(screen.queryByRole('tab')).not.toBeInTheDocument()
    await user.click(await screen.findByRole('button', { name: 'Escalate to machine builder…' }))
    const dialog = await screen.findByRole('dialog')
    await user.click(await within(dialog).findByRole('button', { name: 'Escalate' }))
    expect(await screen.findByRole('tab', { name: 'Conversation' })).toHaveAttribute('aria-selected', 'true')
    await user.click(screen.getByRole('tab', { name: 'Diagnostics' }))
    expect(screen.getByRole('region', { name: 'Agent steps' })).toBeVisible()
  })

  test('machine-builder messages arriving while diagnostics are shown are counted as unread', async () => {
    const user = userEvent.setup()
    openRun('run-1003')
    await user.selectOptions(await screen.findByLabelText('Act'), 'request')
    await user.type(screen.getByLabelText('Message'), 'Is a spare part needed?')
    await user.click(screen.getByRole('button', { name: 'Send' }))
    await user.click(screen.getByRole('tab', { name: 'Diagnostics' }))
    expect(await screen.findByRole('tab', { name: 'Conversation 1 unread' })).toBeVisible()
    await user.click(screen.getByRole('tab', { name: /Conversation/ }))
    expect(screen.getByRole('tab', { name: 'Conversation' })).toHaveAttribute('aria-selected', 'true')
  })
})

describe('message thread', () => {
  test('messages show sender, time and act; outgoing messages show their delivery status', async () => {
    const user = userEvent.setup()
    openRun('run-1003')
    const list = await thread()
    const first = within(list).getAllByRole('listitem')[0]
    expect(first).toHaveTextContent('CoolFlow Process Cooling')
    expect(first).toHaveTextContent('Inform')
    expect(first.querySelector('time')).toHaveAttribute('datetime')
    expect(within(list).getByText('Policy check')).toBeVisible()

    await user.type(screen.getByLabelText('Message'), 'Machine runs at reduced load.')
    await user.click(screen.getByRole('button', { name: 'Send' }))
    const mine = (await within(list).findByText('Machine runs at reduced load.')).closest('li')
    expect(within(mine).getByText('You')).toBeVisible()
    await within(mine).findByText('Delivered', {}, { timeout: 3000 })
  })

  test('a message that cannot be delivered is marked as failed', async () => {
    const user = userEvent.setup()
    openRun('run-1003')
    await user.type(await screen.findByLabelText('Message'), 'Are you there?')
    writeControls({ connection: 'disconnected' })
    await user.click(screen.getByRole('button', { name: 'Send' }))
    const mine = (await within(await thread()).findByText('Are you there?')).closest('li')
    await within(mine).findByText('Delivery failed', {}, { timeout: 3000 })
  })

  test('an empty thread says so and shows what was sent with the escalation', () => {
    const escalation = { ref: 'ESC-1', recipient: { name: 'Formwerk Press Technology' }, tier: 'Tier 1 · machine data', data: [{ label: 'Machine attributes' }, { label: 'Current sensor values' }] }
    renderWithRouter(<MessageThread entries={[]} escalation={escalation} />)
    expect(screen.getByText('No messages exchanged yet.')).toBeVisible()
    expect(screen.getByText(/Sent with escalation/)).toHaveTextContent('ESC-1')
    expect(screen.getByText('Current sensor values')).toBeVisible()
  })
})

describe('structured acts', () => {
  test('an open conversation offers inform, request, direct contact, close and cancel; grant and deny only with a pending request', async () => {
    const user = userEvent.setup()
    openRun('run-1003')
    await screen.findByLabelText('Act')
    expect(actOptions()).toEqual(['Inform', 'Request', 'Ask for direct contact', 'Close with outcome', 'Cancel escalation'])
    await user.selectOptions(screen.getByLabelText('Act'), 'request')
    await user.type(screen.getByLabelText('Message'), 'Is a spare part needed?')
    await user.click(screen.getByRole('button', { name: 'Send' }))
    await waitFor(() => expect(actOptions()).toContain('Grant request'), { timeout: 3000 })
    expect(actOptions()).toContain('Deny request')
    await user.selectOptions(screen.getByLabelText('Act'), 'grant')
    expect(screen.getByText(/In reply to: “Yes, a spare part is likely needed/)).toBeVisible()
    await user.click(screen.getByRole('button', { name: 'Send' }))
    await waitFor(() => expect(actOptions()).not.toContain('Grant request'))
  })

  test('closing with an outcome shows the conversation closed and stops the run', async () => {
    const user = userEvent.setup()
    openRun('run-1003')
    await user.selectOptions(await screen.findByLabelText('Act'), 'close')
    await user.click(screen.getByRole('button', { name: 'Send' }))
    expect(screen.getByRole('alert')).toHaveTextContent('Choose an outcome')
    expect(within(screen.getByLabelText('Outcome')).getAllByRole('option').map((o) => o.textContent)).toEqual(['Choose…', 'Resolved', 'Not resolved'])
    await user.selectOptions(screen.getByLabelText('Outcome'), 'resolved')
    await user.click(screen.getByRole('button', { name: 'Send' }))
    expect(await screen.findByRole('region', { name: 'Stopped' })).toHaveTextContent('Resolved')
    expect(within(await thread()).getByText('Outcome: Resolved')).toBeVisible()
    expect(screen.getAllByText('Closed').length).toBeGreaterThan(0)
    expect(findRun('run-1003').status).toBe('stopped')
  })

  test('direct contact requested by the machine builder: no close or end of direct contact', async () => {
    openNew({ scenario: 'direct_contact', machine: 'press-brake-01', actions: [escalate, act('request', { text: 'What do you recommend?' })] })
    expect(await screen.findByText('Direct contact requested by the machine builder')).toBeVisible()
    expect(actOptions()).toEqual(['Inform', 'Request'])
  })

  test('closing as escalated after the operator asked for direct contact: stopped and not reopenable', async () => {
    const user = userEvent.setup()
    openNew({ scenario: 'direct_contact', machine: 'press-brake-01', actions: [escalate, act('escalate')] })
    expect(await screen.findByText('Direct contact requested by you')).toBeVisible()
    expect(actOptions()).toContain('End direct contact')
    await user.selectOptions(screen.getByLabelText('Act'), 'close')
    await user.selectOptions(screen.getByLabelText('Outcome'), 'escalated')
    await user.click(screen.getByRole('button', { name: 'Send' }))
    const stopped = await screen.findByRole('region', { name: 'Stopped' })
    expect(stopped).toHaveTextContent('Escalated to direct contact')
    expect(within(stopped).getByText('This run cannot be reopened.')).toBeVisible()
    expect(within(stopped).queryByRole('button', { name: 'Reopen…' })).not.toBeInTheDocument()
  })
})

describe('suggested actions and questions to the agent', () => {
  test('using a suggestion prepares the act with its text for review', async () => {
    const user = userEvent.setup()
    openRun('run-1003')
    const suggestions = await screen.findByRole('region', { name: 'Suggested by the incident agent' })
    const outboxBefore = findRun('run-1003').outbox.length
    await user.click(within(suggestions).getByRole('button', { name: /^Use suggestion\s*: Request$/ }))
    expect(screen.getByLabelText('Act')).toHaveValue('request')
    expect(screen.getByLabelText('Message')).toHaveValue('Could you tell us whether a spare part is needed so we can order it in time?')
    expect(screen.getByLabelText('Message')).toHaveFocus()
    expect(findRun('run-1003').outbox).toHaveLength(outboxBefore)
  })

  test('questions and answers appear as agent messages and nothing goes to the machine builder', async () => {
    const user = userEvent.setup()
    openRun('run-1003')
    const outboxBefore = findRun('run-1003').outbox.length
    await user.type(await screen.findByRole('textbox', { name: 'Ask the incident agent' }), 'What did they ask for?')
    await user.click(screen.getByRole('button', { name: 'Ask' }))
    const list = await thread()
    const question = (await within(list).findByText('What did they ask for?')).closest('li')
    expect(question).toHaveTextContent('Question to the agent')
    const answer = (await within(list).findByText(/Escalation ESC-2047 went to CoolFlow Process Cooling/)).closest('li')
    expect(within(answer).getByText('Incident agent')).toBeVisible()
    expect(answer).toHaveTextContent('not sent to the machine builder')
    expect(findRun('run-1003').outbox).toHaveLength(outboxBefore)
  })
})

describe('conversation status check', () => {
  test('checking finds the machine builder closed the conversation', async () => {
    const user = userEvent.setup()
    openNew({ scenario: 'mb_closes', machine: 'extractor-01', actions: [escalate] })
    await user.click(await screen.findByRole('button', { name: 'Check status' }))
    const closed = await screen.findByRole('region', { name: 'Closed by the machine builder' })
    expect(closed).toHaveTextContent('Resolved')
    expect(closed).toHaveTextContent('Our technician replaced the worn part on site')
  })

  test('checking an open conversation says it is not closed', async () => {
    const user = userEvent.setup()
    openRun('run-1003')
    await user.click(await screen.findByRole('button', { name: 'Check status' }))
    expect(await screen.findByText('The machine builder has not closed the conversation.')).toBeVisible()
  })

  test('recording a close moves the run to closed and notes it in the thread', async () => {
    const user = userEvent.setup()
    openRun('run-1003')
    await user.click(await screen.findByRole('button', { name: 'Record close…' }))
    const dialog = screen.getByRole('dialog', { name: 'Record a close by the machine builder' })
    await user.click(within(dialog).getByRole('button', { name: 'Record close' }))
    expect(within(dialog).getByRole('alert')).toHaveTextContent('Enter the reason')
    await user.selectOptions(within(dialog).getByLabelText('Outcome'), 'not_resolved')
    await user.type(within(dialog).getByLabelText('Reason given by the machine builder'), 'Agreed by phone to replace the chiller.')
    await user.click(within(dialog).getByRole('button', { name: 'Record close' }))
    const closed = await screen.findByRole('region', { name: 'Closed by the machine builder (recorded by you)' })
    expect(closed).toHaveTextContent('Not resolved')
    const note = (await within(await thread()).findByText(/Close recorded by the operator: Agreed by phone/)).closest('li')
    expect(note).toHaveTextContent('Recorded by the operator')
  })
})
