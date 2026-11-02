import { SCENARIOS } from '../../src/data/sources/mock/scenarios'
import { createRunRecord, initialCounters, simulate } from '../../src/data/sources/mock/runCore'
import { conversationState, messagesOf } from '../../src/data/conversationActs'

const confirm = ['confirmResolution', { confirmed: true }]
const escalate = ['escalate']
const act = (a, extra = {}) => ['sendConversationAct', { act: a, ...extra }]

/** Operator actions per scenario, matching each scenario's documented `actions`. */
const ACTIONS = {
  happy_path: [confirm],
  low_confidence: [['clarify', { text: 'Only on parts longer than 2 m.' }], confirm],
  rejected_resolution: [['confirmResolution', { confirmed: false, text: 'Replaced last week.' }], confirm],
  escalation_within_tier: [escalate, act('request', { text: 'Is a spare part needed?' })],
  request_beyond_tier: [escalate, ['approveDataRequest', { approved: true }]],
  mb_recommendation: [escalate, ['replyToRecommendation', { action: 'resolved' }]],
  mb_closes: [escalate, ['refreshConversationStatus']],
  stop_and_reopen: [escalate, ['stopRun'], ['reopenRun']],
  direct_contact: [escalate, act('escalate'), act('close', { outcome: 'escalated' })],
  failure: [],
  degraded_data: [confirm],
}

function play(scenario, actions, { machine = 'chiller-01' } = {}) {
  const env = { state: { counters: initialCounters() }, connected: true }
  const run = createRunRecord({ runId: 'run-s', machineId: `urn:ngsi-ld:Machine:${machine}`, issue: 'Scenario test', scenario, at: '2026-11-02T10:00:00.000Z' })
  const events = simulate(run, env, actions, { t: Date.parse(run.startedAt), scale: 1 })
  const statuses = ['running', ...events.filter((e) => e.type === 'status').map((e) => e.status)]
  const path = statuses.filter((s, i) => s !== statuses[i - 1])
  return { run, events, path }
}

test('there are eleven named scenarios', () => {
  expect(SCENARIOS.map((s) => s.id)).toEqual(Object.keys(ACTIONS))
})

describe.each(SCENARIOS.map((s) => [s.id, s]))('%s', (id, scenario) => {
  test('passes through its documented states to its documented end', () => {
    const { run, path } = play(id, ACTIONS[id])
    expect(path).toEqual(scenario.path)
    expect(run.status).toBe(scenario.path.at(-1))
  })
})

test('degraded data: observe names the unavailable source and the run continues with partial data', () => {
  const { run } = play('degraded_data', [])
  const observe = run.steps.find((s) => s.node === 'observe').output
  expect(observe.partialData).toBe(true)
  expect(observe.sources.find((s) => s.status === 'unavailable')).toMatchObject({ source: 'Time-series database' })
  expect(run.status).toBe('awaiting_confirmation')
})

test('rejected resolution: the next proposal lists the rejected one and proposes another cause', () => {
  const { run } = play('rejected_resolution', ACTIONS.rejected_resolution.slice(0, 1))
  expect(run.data.rejected).toHaveLength(1)
  expect(run.data.rootCause).not.toBe(run.data.rejected[0].rootCause)
})

test('machine builder answers a request after a delay, and the request is delivered', () => {
  const { run, events } = play('escalation_within_tier', ACTIONS.escalation_within_tier)
  const messages = messagesOf(run.steps)
  const request = messages.find((m) => m.sender === 'operator' && m.act === 'request')
  const reply = messages[messages.indexOf(request) + 1]
  expect(reply).toMatchObject({ sender: 'machine_builder', act: 'request' })
  expect(Date.parse(reply.at) - Date.parse(request.at)).toBeGreaterThanOrEqual(3000)
  expect(run.outbox.find((o) => o.messageId === request.messageId).status).toBe('delivered')
  expect(events.some((e) => e.node === 'policy_check' && e.output.withheld.length === 0)).toBe(true)
})

test('request beyond tier: nothing beyond the tier is sent before approval', () => {
  const { run } = play('request_beyond_tier', [escalate])
  expect(run.status).toBe('awaiting_operator_approval')
  const beyond = run.data.needsApproval.map((i) => i.label)
  const sent = run.steps.filter((s) => s.node === 'policy_check').flatMap((s) => s.output.sent)
  expect(beyond.length).toBeGreaterThan(0)
  expect(sent.filter((label) => beyond.includes(label))).toEqual([])
})

test('a declined data request is not sent', () => {
  const { run } = play('request_beyond_tier', [escalate, ['approveDataRequest', { approved: false, note: 'Not shared.' }]])
  const last = run.steps.filter((s) => s.node === 'policy_check').at(-1).output
  expect(last.sent).toEqual([])
  expect(last.withheld.length).toBeGreaterThan(0)
  expect(run.status).toBe('awaiting_machine_builder')
})

test('direct contact requested by the machine builder', () => {
  const { run } = play('direct_contact', [escalate, act('request', { text: 'What do you recommend?' })])
  expect(conversationState(run.steps)).toBe('direct_contact_machine_builder')
})

test('closed as escalated is not reopenable', () => {
  const { run } = play('direct_contact', ACTIONS.direct_contact)
  expect(run.data).toMatchObject({ outcome: 'escalated', reopenable: false })
})

test('machine builder closes: the close is seen only after a status check', () => {
  const { run } = play('mb_closes', [escalate])
  expect(run.status).toBe('awaiting_machine_builder')
  const checked = play('mb_closes', ACTIONS.mb_closes).run
  expect(checked.data).toMatchObject({ outcome: 'resolved', recordedBy: 'machine_builder', reason: expect.any(String) })
})

test('scenarios play for every machine kind', () => {
  for (const machine of ['laser-cutter-01', 'press-brake-02', 'deburring-01', 'coating-01', 'chiller-01', 'extractor-01']) {
    expect(play('low_confidence', ACTIONS.low_confidence, { machine }).run.status).toBe('completed')
  }
})
