import { DataError } from '../../errors'
import { applyControls, currentControls, writeControls } from './controls'
import { builderFor, CAPABILITIES, REGISTRY } from './catalog'

/** Mock implementation of the `dataspace` area: connection, peers, policies and capability requests. */

/** Credential the mock gateway accepts when the configuration provides none. */
export const MOCK_DATASPACE_SECRET = 'plant-north-secret'
/** Validity of a dataspace session after connecting. */
export const SESSION_MS = 8 * 60 * 60_000
export const POLICY_ACTIONS = { grant: 'granted', deny: 'denied', reset: 'default' }

export function createDataspaceArea(store) {
  const withControls = (fn) => async (...args) => {
    await applyControls('dataspace')
    return fn(...args)
  }
  const fail = (kind, message) => new DataError('dataspace', kind, message)

  /** Effective state: the preset of the controls, else the stored state (expired once past its expiry). */
  function connectionState() {
    const { connection } = store.get()
    const preset = currentControls().connection
    if (preset) return preset
    if (connection.state === 'connected' && Date.parse(connection.expiresAt) <= Date.now()) return 'expired'
    return connection.state
  }

  function connectionResult() {
    const { connection } = store.get()
    const state = connectionState()
    return {
      state,
      participantId: state === 'not_configured' ? null : connection.participantId,
      expiresAt: state === 'connected' ? connection.expiresAt : null,
      credentialConfigured: state !== 'not_configured' && Boolean(currentControls().credentialConfigured),
      sharingTier: state === 'not_configured' ? null : connection.sharingTier,
    }
  }

  function setState(state) {
    store.update((s) => {
      s.connection.state = state
      s.connection.expiresAt = state === 'connected' ? new Date(Date.now() + SESSION_MS).toISOString() : s.connection.expiresAt
      return s
    })
    // The operator's action replaces a preset of the development controls.
    if (import.meta.env.DEV && currentControls().connection) writeControls({ connection: null })
  }

  function requireConnected() {
    if (connectionState() !== 'connected') throw fail('unavailable', 'Not connected to the dataspace.')
  }

  function requirePeer(peerId) {
    const peer = store.get().peers.find((p) => p.id === peerId)
    if (!peer) throw fail('not_found', `No compatible peer ${peerId} is known.`)
    return peer
  }

  const status = (map, capability) => map?.[capability] ?? 'default'

  const area = {
    getConnection: withControls(connectionResult),

    connect: withControls(({ secret } = {}) => {
      const state = connectionState()
      if (state === 'not_configured') throw fail('conflict', 'No dataspace connection is configured.')
      if (!currentControls().gatewayReachable) throw fail('unavailable', 'The dataspace gateway cannot be reached.')
      if (!currentControls().credentialConfigured && String(secret ?? '') !== MOCK_DATASPACE_SECRET) {
        throw fail('unauthorized', 'The dataspace rejected the credential.')
      }
      setState('connected')
      return connectionResult()
    }),

    disconnect: withControls(() => {
      if (connectionState() === 'not_configured') throw fail('conflict', 'No dataspace connection is configured.')
      setState('disconnected')
    }),

    listPeers: withControls(() => {
      requireConnected()
      return structuredClone(store.get().peers)
    }),

    getPeerCapabilities: withControls((peerId) => {
      requireConnected()
      const peer = requirePeer(peerId)
      const { policies, remoteGrants } = store.get().dataspace
      return {
        peerId: peer.id,
        name: peer.name,
        atPeer: peer.capabilities.map((capability) => ({ capability, status: status(remoteGrants[peer.id], capability) })),
        here: CAPABILITIES.map((capability) => ({ capability, status: status(policies[peer.id], capability) })),
      }
    }),

    listCapabilityRequests: withControls(() => {
      requireConnected()
      return structuredClone(store.get().dataspace.capabilityRequests)
        .sort((a, b) => (b.status === 'pending') - (a.status === 'pending') || b.requestedAt.localeCompare(a.requestedAt))
    }),

    decideCapabilityRequest: withControls((id, { approved, note } = {}) => {
      requireConnected()
      const request = store.get().dataspace.capabilityRequests.find((r) => r.id === id)
      if (!request) throw fail('not_found', `Capability request ${id} does not exist.`)
      if (request.status !== 'pending') throw fail('conflict', `Capability request ${id} was already ${request.status}.`)
      let updated
      store.update((s) => {
        const r = s.dataspace.capabilityRequests.find((x) => x.id === id)
        Object.assign(r, { status: approved ? 'approved' : 'denied', note: String(note ?? '').trim() || null, decidedAt: new Date().toISOString() })
        if (approved) s.dataspace.policies[r.requesterId] = { ...s.dataspace.policies[r.requesterId], [r.capability]: 'granted' }
        updated = structuredClone(r)
        return s
      })
      return updated
    }),

    setCapabilityPolicy: withControls(({ peerId, capability, action } = {}) => {
      requireConnected()
      if (!(action in POLICY_ACTIONS)) throw fail('invalid', `Unknown policy action ${action}; use grant, deny or reset.`)
      if (!CAPABILITIES.includes(capability)) throw fail('invalid', `Unknown capability ${capability}.`)
      requirePeer(peerId)
      store.update((s) => {
        const policy = { ...s.dataspace.policies[peerId] }
        if (action === 'reset') delete policy[capability]
        else policy[capability] = POLICY_ACTIONS[action]
        s.dataspace.policies[peerId] = policy
        return s
      })
    }),

    resolveNames: withControls((ids = []) => Object.fromEntries(
      ids.map((id) => [id, REGISTRY.find((p) => p.id === id)?.name]).filter(([, name]) => name),
    )),

    resolveBuilders: withControls((machineIds = []) => Object.fromEntries(
      machineIds.map((id) => [id, builderFor(id)?.name]).filter(([, name]) => name),
    )),
  }
  return { area, connectionState }
}
