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

import { useId } from 'react'
import { StatusBadge } from '../../ui/components'
import { capabilityLabel, TIERS } from './model'

/**
 * The configured data-sharing tier in one line, with what each tier sends behind a disclosure: it is
 * part of the deployment configuration, so it rarely needs more than a glance.
 */
export default function SharingTier({ tier }) {
  const titleId = useId()
  const configured = TIERS.find((t) => t.id === tier)
  return (
    <section className="sharing-tier" aria-labelledby={titleId}>
      <p>
        <strong id={titleId}>Data-sharing tier</strong>{': '}
        {configured ? <><code>{configured.id}</code> · {configured.title}</> : tier ? <code>{tier}</code> : <span className="muted">none configured</span>}
      </p>
      <details className="sharing-tier__more">
        <summary>What each tier sends</summary>
        <p>
          When you escalate an incident, data about the affected machine is sent to its machine builder. The tier decides what is
          sent automatically; anything beyond it is only sent after you approve the machine builder’s request. The tier is part of
          the deployment configuration and cannot be changed here.
        </p>
        <ol className="tier-list">
          {TIERS.map((t) => {
            const isConfigured = t.id === tier
            return (
              <li key={t.id} className={`tier${isConfigured ? ' tier--configured' : ''}`} aria-current={isConfigured ? 'true' : undefined} data-tier={t.id}>
                <div className="row tier__head">
                  <strong><code>{t.id}</code> · {t.title}</strong>
                  {isConfigured && <StatusBadge kind="tier" value="configured" label="Configured tier" tone="info" />}
                </div>
                <p>{t.sends}</p>
                <p className="muted tier__capabilities">Capabilities: {t.capabilities.map((c) => `${capabilityLabel(c)} (${c})`).join(', ')}</p>
              </li>
            )
          })}
        </ol>
      </details>
    </section>
  )
}
