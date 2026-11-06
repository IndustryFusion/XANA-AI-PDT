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

import { KNOWLEDGE_BASE_ENABLED } from '../../../interface'

/**
 * Building blocks of scenario scripts. Each builder returns timed events for
 * the run engine; delays are base milliseconds at playback speed 1.
 *
 * Event kinds understood by the engine:
 *   { delay, step: { node, input, output } }      agent step
 *   { delay, status, data }                       run state change
 *   { delay, message: { act, text, ... } }        machine-builder message
 *   { delay, dataRequest: { text, items } }       machine-builder data request (policy-checked)
 *   { delay, recommendation: { summary, actions } }
 *   { delay, suggest: [{ act, text }] }           suggested next acts from the incident agent
 *   { delay, remoteClose: { outcome, reason, reopenable } }  close seen only on a status check
 */

const CONFIDENT_THRESHOLD = 0.75

const pct = (n) => Math.round(n * 100) / 100

/** Index of the hypothesis that leads in a round, given how many were rejected. */
const leadIndex = (rejectedCount) => Math.min(rejectedCount, 2)

function confidences(mode, rejectedCount) {
  if (mode === 'low') return [0.48, 0.44, 0.2]
  if (mode === 'clarified') return [0.88, 0.31, 0.12]
  const base = [0.17, 0.24, 0.2]
  base[leadIndex(rejectedCount)] = rejectedCount ? 0.82 : 0.86
  if (!rejectedCount) base[1] = 0.38
  return base
}

function hypothesesFor(ctx, round, values, validated) {
  return ctx.content.hypotheses
    .map((h, i) => ({
      id: `h${round}-${i + 1}`,
      title: h.title,
      confidence: pct(values[i]),
      evidence: h.evidence,
      ...(validated ? { validation: h.note } : {}),
    }))
}

function observe(ctx, { degraded }) {
  const sources = [
    { source: 'Context broker', status: 'ok', detail: 'Machine and component attributes read.' },
    { source: 'Time-series database', status: degraded ? 'unavailable' : 'ok', detail: degraded ? 'Not reachable; trends could not be loaded.' : '24 h of sensor values read.' },
    { source: 'Alert manager', status: 'ok', detail: 'Active alerts of the machine read.' },
  ]
  return {
    delay: 900,
    step: {
      node: 'observe',
      input: { machineId: ctx.run.machineId, issue: ctx.run.issue },
      output: {
        summary: degraded
          ? `Current values of ${ctx.content.machineName} read; history unavailable, continuing with partial data.`
          : `Current values and 24 h history of ${ctx.content.machineName} read.`,
        signals: ctx.content.signals.map(([name, value, unit, assessment]) => ({ name, value, unit, assessment })),
        sources,
        partialData: degraded,
      },
    },
  }
}

/** One analysis round: (observe, and document retrieval if the knowledge base is on, on the first round), hypothesize, validate, decide. */
export function analysis(ctx, { mode = 'confident', degraded = false } = {}) {
  const round = ctx.run.round
  const rejectedCount = ctx.run.rejected.length
  const values = confidences(mode, rejectedCount)
  const lead = mode === 'confident' ? leadIndex(rejectedCount) : 0
  const events = []
  if (round === 1) {
    events.push(observe(ctx, { degraded }))
    if (KNOWLEDGE_BASE_ENABLED) {
      events.push({
        delay: 1100,
        step: {
          node: 'retrieve_documents',
          input: { query: ctx.run.issue },
          output: { passages: ctx.content.manuals.map((title, i) => ({ title, relevance: pct(0.82 - i * 0.11) })) },
        },
      })
    }
  }
  const context = ctx.run.rejected.length
    ? { rejectedRootCauses: ctx.run.rejected.map((r) => r.rootCause), reason: ctx.run.rejected[ctx.run.rejected.length - 1].reason }
    : mode === 'clarified' ? { clarification: ctx.lastClarification ?? null } : { observations: ctx.content.signals.length }
  events.push({
    delay: 1300,
    step: { node: 'hypothesize', input: context, output: { hypotheses: hypothesesFor(ctx, round, [0.7, 0.55, 0.3], false) } },
  })
  if (round === 1) {
    events.push({
      delay: 1000,
      step: {
        node: 'retrieve_similar_incidents',
        input: { machineType: ctx.content.machineName },
        output: { matches: [{ incident: 'Incident #17', rootCause: ctx.content.hypotheses[0].title, similarity: 0.71 }] },
      },
    })
  }
  const validated = hypothesesFor(ctx, round, values, true)
  events.push({ delay: 1400, step: { node: 'validate', input: { hypotheses: validated.map((h) => h.id) }, output: { hypotheses: validated } } })

  if (mode === 'low') {
    const confidence = values[0]
    events.push({
      delay: 1000,
      step: { node: 'decide', input: { threshold: CONFIDENT_THRESHOLD }, output: { rootCause: null, recommendedAction: null, confidence, threshold: CONFIDENT_THRESHOLD, question: ctx.content.question } },
    })
    events.push({ delay: 300, status: 'awaiting_input', data: { question: ctx.content.question, confidence, threshold: CONFIDENT_THRESHOLD } })
    return events
  }

  const decision = {
    rootCause: ctx.content.hypotheses[lead].title,
    recommendedAction: ctx.content.actions[lead],
    confidence: values[lead],
  }
  events.push({ delay: 1000, step: { node: 'decide', input: { threshold: CONFIDENT_THRESHOLD }, output: { ...decision, threshold: CONFIDENT_THRESHOLD } } })
  events.push({ delay: 300, status: 'awaiting_confirmation', data: { ...decision, rejected: ctx.run.rejected } })
  return events
}

/** The operator confirmed: the agent logs the incident and the run completes. */
export function complete(ctx) {
  const decision = [...ctx.run.steps].reverse().find((s) => s.node === 'decide' && s.output.rootCause)?.output ?? {}
  return [
    { delay: 800, step: { node: 'act', input: { decision: decision.rootCause ?? null }, output: { action: 'Incident logged with the confirmed resolution', recommendedAction: decision.recommendedAction ?? null, incidentLogged: true } } },
    { delay: 300, status: 'completed', data: { rootCause: decision.rootCause ?? null, recommendedAction: decision.recommendedAction ?? null, confidence: decision.confidence ?? null, incidentLogged: true } },
  ]
}

/** The agent stops with an error after a few steps. */
export function failure(ctx) {
  return [
    observe(ctx, { degraded: false }),
    { delay: 1300, step: { node: 'hypothesize', input: { observations: ctx.content.signals.length }, output: { hypotheses: hypothesesFor(ctx, 1, [0.7, 0.55, 0.3], false) } } },
    { delay: 1500, status: 'failed', data: { error: 'The language model did not respond within 60 s during validation.', node: 'validate' } },
  ]
}

/* ── Simulated machine builder ───────────────────────────────────────────── */

export const mb = {
  say: (text, extra = {}, delay = 3500) => ({ delay, message: { act: 'inform', text, ...extra } }),
  ask: (text, delay = 4000) => ({ delay, message: { act: 'request', text } }),
  directContact: (text, delay = 3500) => ({ delay, message: { act: 'escalate', text, convState: 'direct_contact_machine_builder' } }),
  dataRequest: (text, items, delay = 3000) => ({ delay, dataRequest: { text, items: items.map(([label, category]) => ({ label, category })) } }),
  recommendation: (rec, delay = 5000) => ({ delay, recommendation: rec }),
  closeRemotely: (outcome, reason, delay = 4000) => ({ delay, remoteClose: { outcome, reason, reopenable: outcome !== 'escalated' } }),
}

export const suggest = (list, delay = 700) => ({ delay, suggest: list.map(([act, text]) => ({ act, text })) })

/** Default reactions of the simulated machine builder, used unless a scenario overrides them. */
export const DEFAULT_REACTIONS = {
  escalate: (ctx) => [
    mb.say(`Thank you. We received escalation for ${ctx.content.machineName} and are reviewing the shared data.`),
    suggest([['request', 'Could you share an estimate of when you can give a first assessment?']]),
  ],
  inform: () => [mb.say('Noted, thank you. We include this in our analysis.')],
  request: (ctx) => [
    mb.say(`Our first assessment: ${ctx.content.hypotheses[0].title.toLowerCase()} is the most likely cause. We will confirm within the day.`),
    suggest([['inform', 'Thank you. We will keep the machine in reduced operation until then.']]),
  ],
  grant: () => [mb.say('Thank you, we have scheduled it.')],
  deny: () => [mb.say('Understood. We continue with the information available.')],
  escalate_act: () => [mb.say('Agreed. Our service lead will contact your maintenance team directly today.')],
  deescalate: () => [mb.say('Fine, we continue here in the structured conversation.')],
  approved: () => [mb.say('Thank you for the additional data. It confirms our assessment.')],
  declined: () => [mb.say('Understood. We work with the data within your sharing tier.')],
  still_failing: () => [mb.say('Sorry to hear that. We are checking further options and come back to you.')],
  reopen: () => [mb.say('We see the conversation was reopened. What has changed since?')],
}
