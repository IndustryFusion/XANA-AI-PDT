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
