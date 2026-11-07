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

import { useRef, useState } from 'react'
import { dataspace } from '../../data'
import { useData } from '../../data/useData'
import { Link } from '../../app/router'
import { useRevealOnChange } from '../../app/reveal'
import { Button, Card, DataView, EmptyState, StatusBadge, useToast } from '../../ui/components'
import { ConfirmDialog } from '../../ui/structured'
import { capabilityDescription, capabilityLabel, dataspacePath, POLICY_ACTIONS } from './model'

/**
 * Compatible peers (left) and the selected peer's capabilities in both
 * directions (right), with policy actions on what the peer may access here.
 */
export default function Peers({ selected, factoryName, policyKey, onPolicyChange }) {
  const peers = useData('dataspace', 'listPeers')
  const detailRef = useRef(null)
  useRevealOnChange(detailRef, selected ?? '')
  return (
    <Card title="Compatible peers" className="peers">
      <DataView
        result={peers}
        errorTitle="Could not load peers"
        isEmpty={(list) => list.length === 0}
        empty={<EmptyState title="No compatible peers were found in the dataspace." />}
      >
        {(list) => (
          <div className="peers__layout">
            <ul className="peer-list" aria-label="Peers">
              {list.map((p) => (
                <li key={p.id}>
                  <Link to={dataspacePath(p.id)} className="peer-list__link" aria-current={selected === p.id ? 'true' : undefined}>
                    <span className="peer-list__name">{p.name}</span>
                    <span className="mono muted">{p.id}</span>
                    <span className={`level level--${p.accessLevel ?? 'unknown'}`} data-testid="access-level">
                      {p.accessLevel ? `${p.accessLevel[0].toUpperCase()}${p.accessLevel.slice(1)} access` : 'Access unknown'}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
            <div className="peers__detail" ref={detailRef}>
              {selected
                ? <PeerCapabilities key={selected} peerId={selected} factoryName={factoryName} policyKey={policyKey} onPolicyChange={onPolicyChange} />
                : <p className="muted">Select a peer to see what each side may access.</p>}
            </div>
          </div>
        )}
      </DataView>
    </Card>
  )
}

function PeerCapabilities({ peerId, factoryName, policyKey, onPolicyChange }) {
  const result = useData('dataspace', 'getPeerCapabilities', [peerId], { refreshKey: policyKey })
  const [pending, setPending] = useState(null)
  const notify = useToast()

  return (
    <DataView result={result} errorTitle="Could not load the peer’s capabilities">
      {(caps) => (
        <section className="stack" aria-label={`Capabilities of ${caps.name}`}>
          <h3>{caps.name}</h3>
          <CapabilityTable
            caption={`What ${factoryName} may access at ${caps.name}`}
            rows={caps.atPeer}
          />
          <CapabilityTable
            caption={`What ${caps.name} may access here`}
            rows={caps.here}
            actions={(row) => POLICY_ACTIONS.filter((a) => a.status !== row.status).map((a) => (
              <Button
                key={a.action} size="sm"
                aria-label={`${a.label} ${capabilityLabel(row.capability)} for ${caps.name}`}
                onClick={() => setPending({ ...a, capability: row.capability })}
              >
                {a.label}…
              </Button>
            ))}
          />
          <ConfirmDialog
            open={!!pending}
            title={pending ? `${pending.label}: ${capabilityLabel(pending.capability)} for ${caps.name}` : ''}
            confirmLabel={pending?.label}
            onClose={() => setPending(null)}
            onConfirm={async () => {
              await dataspace.setCapabilityPolicy({ peerId, capability: pending.capability, action: pending.action })
              notify(`${capabilityLabel(pending.capability)} is now ${pending.status} for ${caps.name}.`, 'success')
              onPolicyChange()
            }}
          >
            {pending && <PolicyConsequence action={pending.action} capability={pending.capability} peer={caps.name} />}
          </ConfirmDialog>
        </section>
      )}
    </DataView>
  )
}

function PolicyConsequence({ action, capability, peer }) {
  const what = <><strong>{capabilityLabel(capability)}</strong> (<code>{capability}</code>): {capabilityDescription(capability) ?? 'this capability'}</>
  if (action === 'grant') return <p>{peer} will be allowed to access {what}.</p>
  if (action === 'deny') return <p>{peer} will no longer be allowed to access {what}.</p>
  return <p>The policy for {peer} on {what} returns to the default of the dataspace.</p>
}

function CapabilityTable({ caption, rows, actions }) {
  return (
    <div className="table-wrap">
      <table className="table capability-table">
        <caption>{caption}</caption>
        <thead>
          <tr>
            <th scope="col">Capability</th>
            <th scope="col">Status</th>
            {actions && <th scope="col">Policy</th>}
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 && <tr><td colSpan={actions ? 3 : 2} className="muted">No capabilities.</td></tr>}
          {rows.map((row) => (
            <tr key={row.capability} data-capability={row.capability}>
              <th scope="row">
                {capabilityLabel(row.capability)} <span className="mono muted capability-id">{row.capability}</span>
                {capabilityDescription(row.capability) && <span className="capability-table__description muted">{capabilityDescription(row.capability)}</span>}
              </th>
              <td><StatusBadge kind="policy" value={row.status} /></td>
              {actions && <td><div className="row">{actions(row)}</div></td>}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
