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

import { useId, useState } from 'react'
import { MESSAGE_KINDS } from '../../data/conversationActs'
import { StructuredFields } from '../../ui/structured'
import { confidenceTone } from '../../ui/status'
import { formatTime, humanize, percent } from '../../ui/format'
import { feedSteps, stepLabel } from './runModel'

const SENDERS = { operator: 'Operator', agent: 'Incident agent', machine_builder: 'Machine builder' }
const count = (list, one, many) => `${list?.length ?? 0} ${list?.length === 1 ? one : many}`
const lead = (hypotheses = []) => [...hypotheses].sort((a, b) => b.confidence - a.confidence)[0]

/** One-line summaries of known step kinds. */
const SUMMARIES = {
  observe: (o) => o.summary,
  hypothesize: (o) => `${count(o.hypotheses, 'hypothesis', 'hypotheses')}; leading: ${lead(o.hypotheses)?.title} (${percent(lead(o.hypotheses)?.confidence)})`,
  validate: (o) => `${count(o.hypotheses, 'hypothesis', 'hypotheses')} validated; leading: ${lead(o.hypotheses)?.title} (${percent(lead(o.hypotheses)?.confidence)})`,
  decide: (o) => (o.rootCause
    ? `Root cause: ${o.rootCause} (${percent(o.confidence)})`
    : `No root cause above the ${percent(o.threshold)} threshold (${percent(o.confidence)}); asking the operator`),
  act: (o) => o.action,
  clarification: (o) => `Operator clarified: “${o.text || 'files only'}”${o.files?.length ? ` with ${count(o.files, 'file', 'files')}` : ''}`,
  resolution: (o) => (o.confirmed ? `Operator confirmed: ${o.rootCause}` : `Operator rejected “${o.rootCause}”: ${o.reason}`),
  escalate: (o) => `Escalated to ${o.recipient} as ${o.escalationRef}`,
  suggest: (o) => `${count(o.suggestions, 'suggested act', 'suggested acts')} for the conversation`,
  policy_check: (o) => o.decision,
  message: (o) => `${SENDERS[o.sender] ?? o.sender} (${MESSAGE_KINDS[o.act] ?? o.act}): ${o.text}`,
}

/** Short preview of any structured output: "Passages: 2 items · Query: …". */
function genericSummary(output) {
  if (!output || typeof output !== 'object') return String(output ?? '')
  return Object.entries(output).slice(0, 3).map(([k, v]) => {
    const value = Array.isArray(v) ? `${v.length} ${v.length === 1 ? 'item' : 'items'}`
      : v && typeof v === 'object' ? `${Object.keys(v).length} fields`
        : String(v).length > 60 ? `${String(v).slice(0, 57)}…` : String(v)
    return `${humanize(k)}: ${value}`
  }).join(' · ')
}

function PolicyCheck({ output }) {
  return (
    <StructuredFields value={{ tier: output.tier, recipient: output.recipient, sent: output.sent, withheld: output.withheld }} />
  )
}

/** One step of the feed: kind, time, summary and expandable structured output. */
export function StepItem({ step, showInput = false }) {
  const [open, setOpen] = useState(false)
  const detailsId = useId()
  const label = stepLabel(step.node)
  const summary = SUMMARIES[step.node]?.(step.output ?? {}) ?? genericSummary(step.output)
  const confidence = step.output?.confidence ?? lead(step.output?.hypotheses)?.confidence
  const toned = confidence != null ? ` toned toned--${confidenceTone(confidence)}` : ''
  return (
    <li className={`step step--${SUMMARIES[step.node] ? step.node : 'generic'}${toned}`} data-node={step.node}>
      <div className="step__head">
        <span className="step__kind">{label}</span>
        <time className="muted step__time" dateTime={step.at}>{formatTime(step.at)}</time>
      </div>
      <p className="step__summary">{summary}</p>
      {step.node === 'policy_check' && <PolicyCheck output={step.output} />}
      <button type="button" className="step__toggle" aria-expanded={open} aria-controls={detailsId} onClick={() => setOpen((o) => !o)}>
        {open ? 'Hide details' : 'Show details'}<span className="visually-hidden"> of {label} step</span>
      </button>
      {open && (
        <div id={detailsId} className="step__details">
          {showInput && (
            <section aria-label={`Input of ${label} step`}>
              <h4 className="step__details-title">Input</h4>
              <StructuredFields value={step.input} />
            </section>
          )}
          <section aria-label={`Output of ${label} step`}>
            {showInput && <h4 className="step__details-title">Output</h4>}
            <StructuredFields value={step.output} />
          </section>
        </div>
      )}
    </li>
  )
}

/** Agent steps in the order they completed; new steps appear at the end. */
export default function StepFeed({ steps, running }) {
  const shown = feedSteps(steps)
  return (
    <section className="card step-feed" aria-labelledby="step-feed-title">
      <header className="card__header"><h3 id="step-feed-title" className="card__title">Agent steps</h3></header>
      <div className="card__body">
        {shown.length === 0 && !running && <p className="muted">No steps yet.</p>}
        <ol className="step-feed__list">
          {shown.map((step, i) => <StepItem key={`${i}-${step.node}`} step={step} />)}
        </ol>
        {running && (
          <p className="step-feed__progress" role="status">
            <span className="spinner" aria-hidden="true" /> The agent is working…
          </p>
        )}
      </div>
    </section>
  )
}
