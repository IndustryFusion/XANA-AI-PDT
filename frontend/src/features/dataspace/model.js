/** Plain-word descriptions of dataspace capabilities and data-sharing tiers. */

export const CAPABILITY_INFO = {
  'twin:direct': { label: 'Machine entity', description: 'the machine’s own attributes and current values' },
  'twin:adjacents': { label: 'Linked components', description: 'components, sensors and the production line linked to the machine' },
  'twin:history': { label: 'Signal history', description: 'past values of the machine’s signals' },
}

export const capabilityLabel = (id) => CAPABILITY_INFO[id]?.label ?? id
export const capabilityDescription = (id) => CAPABILITY_INFO[id]?.description ?? null

/** Data-sharing tiers in increasing order of what they send (architecture.md → Policy-gated data sharing). */
export const TIERS = [
  {
    id: 'minimal',
    title: 'Machine entity only',
    capabilities: ['twin:direct'],
    sends: 'The affected machine’s own attributes and current values, for example its status, configuration and current sensor values.',
  },
  {
    id: 'adjacent',
    title: 'Plus linked components',
    capabilities: ['twin:direct', 'twin:adjacents'],
    sends: 'Everything of the minimal tier, plus the components, sensors and production line linked to the machine.',
  },
  {
    id: 'timeseries',
    title: 'Plus signal history',
    capabilities: ['twin:direct', 'twin:adjacents', 'twin:history'],
    sends: 'Everything of the adjacent tier, plus the history of the machine’s signals, for example the last days of temperature or pressure values.',
  },
]

export const dataspacePath = (peerId) => (peerId ? `/dataspace?peer=${encodeURIComponent(peerId)}` : '/dataspace')

/** Policy actions on what a peer may access here, and the status each leads to. */
export const POLICY_ACTIONS = [
  { action: 'grant', label: 'Grant', status: 'granted' },
  { action: 'deny', label: 'Deny', status: 'denied' },
  { action: 'reset', label: 'Reset to default', status: 'default' },
]
