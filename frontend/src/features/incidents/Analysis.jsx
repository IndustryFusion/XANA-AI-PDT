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

import { ConfidenceMeter } from '../../ui/structured'
import { confidenceTone } from '../../ui/status'
import { currentDecision, currentHypotheses } from './runModel'

/** Hypotheses with confidence and evidence; validated ones replace the proposal. */
export function HypothesisList({ steps }) {
  const current = currentHypotheses(steps)
  if (!current) return null
  return (
    <section className="card" aria-labelledby="hypotheses-title">
      <header className="card__header">
        <h3 id="hypotheses-title" className="card__title">{current.validated ? 'Validated hypotheses' : 'Hypotheses (not validated yet)'}</h3>
      </header>
      <div className="card__body">
        <ol className="hypotheses">
          {current.hypotheses.map((h) => (
            <li key={h.id} className={`hypothesis toned toned--${confidenceTone(h.confidence)}`}>
              <div className="hypothesis__head">
                <strong>{h.title}</strong>
                <ConfidenceMeter value={h.confidence} />
              </div>
              {h.evidence?.length > 0 && (
                <div className="hypothesis__part">
                  <span className="muted">Evidence</span>
                  <ul>{h.evidence.map((e) => <li key={e}>{e}</li>)}</ul>
                </div>
              )}
              {h.validation && (
                <p className="hypothesis__part"><span className="muted">Validation notes </span>{h.validation}</p>
              )}
            </li>
          ))}
        </ol>
      </div>
    </section>
  )
}

/** The agent's decision: root cause, recommended action and confidence. */
export function DecisionCard({ steps }) {
  const decision = currentDecision(steps)
  if (!decision) return null
  return (
    <section className={`card decision toned toned--${confidenceTone(decision.confidence)}`} aria-labelledby="decision-title">
      <header className="card__header">
        <h3 id="decision-title" className="card__title">Decision</h3>
        <ConfidenceMeter value={decision.confidence} />
      </header>
      <div className="card__body">
        <dl className="details">
          <dt>Root cause</dt><dd>{decision.rootCause}</dd>
          <dt>Recommended action</dt><dd>{decision.recommendedAction}</dd>
        </dl>
      </div>
    </section>
  )
}
