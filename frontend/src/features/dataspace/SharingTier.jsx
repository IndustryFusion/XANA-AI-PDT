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

import { Card, StatusBadge } from '../../ui/components'
import { capabilityLabel, TIERS } from './model'

/** The configured data-sharing tier, and what each tier sends, in plain words. */
export default function SharingTier({ tier, status }) {
  const known = TIERS.some((t) => t.id === tier)
  return (
    <Card title="Data-sharing tier" className="sharing-tier">
      <div className="stack">
        <p>
          When you escalate an incident, data about the affected machine is sent to its machine builder. The tier decides what is
          sent automatically; anything beyond it is only sent after you approve the machine builder’s request. The tier is part of
          the deployment configuration and cannot be changed here.
        </p>
        {status === 'error' && <p className="muted">The configured tier could not be loaded.</p>}
        {status === 'success' && !tier && <p className="muted">No tier is configured because there is no dataspace connection.</p>}
        {status === 'success' && tier && !known && <p>Configured tier: <code>{tier}</code></p>}
        <ol className="tier-list">
          {TIERS.map((t) => {
            const configured = t.id === tier
            return (
              <li key={t.id} className={`tier${configured ? ' tier--configured' : ''}`} aria-current={configured ? 'true' : undefined} data-tier={t.id}>
                <div className="row tier__head">
                  <strong><code>{t.id}</code> · {t.title}</strong>
                  {configured && <StatusBadge kind="tier" value="configured" label="Configured tier" tone="info" />}
                </div>
                <p>{t.sends}</p>
                <p className="muted tier__capabilities">Capabilities: {t.capabilities.map((c) => `${capabilityLabel(c)} (${c})`).join(', ')}</p>
              </li>
            )
          })}
        </ol>
      </div>
    </Card>
  )
}
