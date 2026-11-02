/**
 * Named scenarios of the mock run engine. A scenario is data: named stages
 * (timed events, then optionally a wait for an operator action that selects
 * the next stage) and the reactions of the simulated machine builder.
 *
 * `path` documents the run states a scenario passes through when the operator
 * takes its `actions`; the scenario tests and the end-to-end tests check it.
 */
import { analysis, complete, DEFAULT_REACTIONS, failure, mb, suggest } from './stages'

const confirmWait = { confirm: 'confirmed', reject: 'rejected' }

/** Stages shared by every diagnosis that ends in a proposed resolution. */
const resolutionStages = {
  clarified: { events: (ctx) => analysis(ctx, { mode: 'clarified' }), wait: confirmWait },
  rejected: { events: (ctx) => analysis(ctx, { mode: 'confident' }), wait: confirmWait },
  confirmed: { events: complete },
}

/** Diagnosis with low confidence: the run asks for input (or escalation). */
const lowConfidenceStart = {
  start: { events: (ctx) => analysis(ctx, { mode: 'low' }), wait: { clarify: 'clarified' } },
  ...resolutionStages,
}

const confidentStart = (options = {}) => ({
  start: { events: (ctx) => analysis(ctx, { mode: 'confident', ...options }), wait: confirmWait },
  ...resolutionStages,
})

export const SCENARIOS = [
  {
    id: 'happy_path',
    label: 'Happy path',
    description: 'Confident diagnosis; the operator confirms the resolution and the run completes.',
    actions: ['Confirm the resolution'],
    path: ['running', 'awaiting_confirmation', 'running', 'completed'],
    stages: confidentStart(),
  },
  {
    id: 'low_confidence',
    label: 'Low confidence',
    description: 'Confidence below the threshold; the agent asks a question, the operator clarifies, then confirms.',
    actions: ['Submit a clarification', 'Confirm the resolution'],
    path: ['running', 'awaiting_input', 'running', 'awaiting_confirmation', 'running', 'completed'],
    stages: lowConfidenceStart,
  },
  {
    id: 'rejected_resolution',
    label: 'Rejected resolution',
    description: 'The operator rejects the first proposal with a reason; a new round proposes another resolution.',
    actions: ['Reject with a reason', 'Confirm the second resolution'],
    path: ['running', 'awaiting_confirmation', 'running', 'awaiting_confirmation', 'running', 'completed'],
    stages: confidentStart(),
  },
  {
    id: 'escalation_within_tier',
    label: 'Escalation within tier',
    description: 'Escalation; the machine builder requests data within the sharing tier, which is sent automatically, and answers requests.',
    actions: ['Escalate', 'Send a request'],
    path: ['running', 'awaiting_input', 'awaiting_machine_builder'],
    stages: lowConfidenceStart,
    reactions: {
      escalate: (ctx) => [
        mb.say(`Thank you. We are looking at ${ctx.content.machineName}.`),
        mb.dataRequest('Please share the following data for our analysis.', ctx.content.dataRequest),
        suggest([['request', 'Could you tell us whether a spare part is needed so we can order it in time?']]),
      ],
      request: () => [
        mb.ask('Yes, a spare part is likely needed. May our technician open a remote session to the machine controller tomorrow at 9:00?'),
        suggest([['grant', 'Granted. The machine will be available tomorrow at 9:00.']]),
      ],
    },
  },
  {
    id: 'request_beyond_tier',
    label: 'Request beyond tier',
    description: 'The machine builder requests data beyond the sharing tier; the run waits for the operator’s approval.',
    actions: ['Escalate', 'Approve or decline the data request'],
    path: ['running', 'awaiting_input', 'awaiting_machine_builder', 'awaiting_operator_approval', 'awaiting_machine_builder'],
    stages: lowConfidenceStart,
    reactions: {
      escalate: (ctx) => [
        mb.say('Thank you for the escalation.'),
        mb.dataRequest('To narrow this down we need more data.', [...ctx.content.dataRequest.slice(0, 1), ...ctx.content.beyondTier]),
      ],
    },
  },
  {
    id: 'mb_recommendation',
    label: 'Machine-builder recommendation',
    description: 'The machine builder sends a recommendation with action items; the operator reports it resolved.',
    actions: ['Escalate', 'Answer the recommendation with "resolved"'],
    path: ['running', 'awaiting_input', 'awaiting_machine_builder', 'awaiting_recommendation_review', 'completed'],
    stages: lowConfidenceStart,
    reactions: {
      escalate: (ctx) => [
        mb.say('Thank you. We have analysed the shared data.'),
        mb.recommendation(ctx.content.recommendation),
      ],
      still_failing: () => [mb.directContact('Then we would like to talk to your maintenance team directly. Our service lead will call today.')],
    },
  },
  {
    id: 'mb_closes',
    label: 'Machine builder closes',
    description: 'The machine builder closes the conversation; the operator sees it after checking the conversation status.',
    actions: ['Escalate', 'Check the conversation status'],
    path: ['running', 'awaiting_input', 'awaiting_machine_builder', 'mb_closed'],
    stages: lowConfidenceStart,
    reactions: {
      escalate: () => [
        mb.say('Thank you. Our service technician is on site at your plant this week and will look at it.'),
        mb.closeRemotely('resolved', 'Our technician replaced the worn part on site; the machine is back in normal operation.'),
      ],
    },
  },
  {
    id: 'stop_and_reopen',
    label: 'Stop and reopen',
    description: 'The operator stops an escalated run and reopens it; the conversation continues.',
    actions: ['Escalate', 'Stop the run', 'Reopen the run'],
    path: ['running', 'awaiting_input', 'awaiting_machine_builder', 'stopped', 'awaiting_machine_builder'],
    stages: lowConfidenceStart,
  },
  {
    id: 'direct_contact',
    label: 'Direct contact',
    description: 'The operator asks for direct contact and closes the conversation as escalated; a request makes the machine builder ask for direct contact instead.',
    actions: ['Escalate', 'Ask for direct contact', 'Close with outcome "escalated"'],
    path: ['running', 'awaiting_input', 'awaiting_machine_builder', 'stopped'],
    stages: lowConfidenceStart,
    reactions: {
      request: () => [mb.directContact('This needs a closer look. We would like to continue directly with your maintenance team.')],
    },
  },
  {
    id: 'failure',
    label: 'Failure',
    description: 'The agent fails during validation; the run ends as failed.',
    actions: [],
    path: ['running', 'failed'],
    stages: { start: { events: failure } },
  },
  {
    id: 'degraded_data',
    label: 'Degraded data',
    description: 'One data source is unavailable; the agent continues with partial data and proposes a resolution.',
    actions: ['Confirm the resolution'],
    path: ['running', 'awaiting_confirmation', 'running', 'completed'],
    stages: confidentStart({ degraded: true }),
  },
]

export const DEFAULT_SCENARIO = 'happy_path'

export function getScenario(id) {
  return SCENARIOS.find((s) => s.id === id) ?? SCENARIOS.find((s) => s.id === DEFAULT_SCENARIO)
}

/**
 * Reactions of the simulated machine builder to `trigger` in a scenario:
 * `escalate` (escalation), an operator act (`inform`, `request`, `grant`,
 * `deny`, `escalate_act`, `deescalate`), `approved`, `declined`,
 * `still_failing` or `reopen`.
 */
export function reactionsFor(scenario, trigger, ctx) {
  const fn = scenario.reactions?.[trigger] ?? DEFAULT_REACTIONS[trigger]
  return fn ? fn(ctx) : []
}
