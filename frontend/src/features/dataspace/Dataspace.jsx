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

import { useState } from 'react'
import { CONNECTION_CHANGED } from '../../data'
import { useData } from '../../data/useData'
import { useRoute } from '../../app/router'
import { CONNECTION_POLL_MS } from '../../app/Header'
import { Card } from '../../ui/components'
import CapabilityRequests from './CapabilityRequests'
import ConnectionSection from './ConnectionSection'
import Peers from './Peers'
import SharingTier from './SharingTier'
import ConfigurationPanel from './ConfigurationPanel'
import './dataspace.css'

const ON_CONNECTION_CHANGE = [CONNECTION_CHANGED]

function unavailableReason(state) {
  if (!state) return 'Not available: the dataspace connection could not be checked.'
  if (state === 'not_configured') return 'Not available: no dataspace connection is configured.'
  return 'Not available while the dataspace is not connected. Connect above to see compatible peers and incoming requests.'
}

/**
 * Dataspace area: the connection with the data-sharing tier next to it,
 * compatible peers with the selected peer's capabilities (`?peer=` in the
 * URL), and incoming capability requests.
 */
export default function Dataspace() {
  const { query } = useRoute()
  const connection = useData('dataspace', 'getConnection', [], { refreshMs: CONNECTION_POLL_MS, refreshOn: ON_CONNECTION_CHANGE })
  const factory = useData('session', 'getFactory')
  const [policyKey, setPolicyKey] = useState(0)
  const bump = () => setPolicyKey((k) => k + 1)
  const state = connection.data?.state

  return (
    <section className="page dataspace" aria-labelledby="page-title">
      <div className="page__header">
        <h1 id="page-title">Dataspace</h1>
      </div>
      <div className="dataspace__top">
        <ConnectionSection result={connection} />
        <SharingTier tier={connection.data?.sharingTier} status={connection.data ? 'success' : connection.status} />
        <ConfigurationPanel state={state} refreshKey={state} />
      </div>
      {state === 'connected' && (
        <>
          <Peers selected={query.peer ?? null} factoryName={factory.data?.name ?? 'this factory'} policyKey={policyKey} onPolicyChange={bump} />
          <CapabilityRequests refreshKey={policyKey} onDecided={bump} />
        </>
      )}
      {state !== 'connected' && (state || connection.status === 'error') && (
        <Card title="Peers and capability requests">
          <p className="muted">{unavailableReason(state)}</p>
        </Card>
      )}
    </section>
  )
}
