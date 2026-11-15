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

/** Plain-word descriptions of dataspace capabilities and data-sharing tiers. */

export const CAPABILITY_INFO = {
  // The names the dataspace gateway gives them, so this page and the gateway's answers agree.
  'twin:direct': { label: 'Machine twin', description: 'current state and sensor values of the machine in question', sensitivity: 'low' },
  'twin:adjacents': { label: 'Neighbouring machines', description: 'state of what is connected to the machine in question, such as components, sensors and its production line', sensitivity: 'medium' },
  'twin:history': { label: 'Machine history', description: 'past values and events of the machine, for comparing runs over time', sensitivity: 'high' },
}

/** How much a capability reveals, as the sharing tiers order them: low, medium or high; null when unknown. */
export const capabilitySensitivity = (id) => CAPABILITY_INFO[id]?.sensitivity ?? null

/** `machine_builder`, or an IRI ending in it (`…/dataspace#machine_builder`) → `Machine builder`. */
export function participantTypeLabel(type) {
  const term = String(type ?? '').split(/[#/]/).filter(Boolean).pop()
  if (!term) return null
  const words = term.replaceAll('_', ' ').replaceAll('-', ' ').trim()
  return words ? `${words[0].toUpperCase()}${words.slice(1)}` : null
}

/** The name of a capability: the gateway's label when it gives one, else ours, else its ID. */
export const capabilityLabel = (id, row) => row?.label || CAPABILITY_INFO[id]?.label || id
export const capabilityDescription = (id, row) => row?.description || CAPABILITY_INFO[id]?.description || null

/** Data-sharing tiers in increasing order of what they send (architecture.md → Policy-gated data sharing). */
export const TIERS = [
  {
    id: 'minimal',
    title: 'Machine twin only',
    capabilities: ['twin:direct'],
    sends: 'The affected machine’s own attributes and current values, for example its status, configuration and current sensor values.',
  },
  {
    id: 'adjacent',
    title: 'Plus neighbouring machines',
    capabilities: ['twin:direct', 'twin:adjacents'],
    sends: 'Everything of the minimal tier, plus the components, sensors and production line linked to the machine.',
  },
  {
    id: 'timeseries',
    title: 'Plus machine history',
    capabilities: ['twin:direct', 'twin:adjacents', 'twin:history'],
    sends: 'Everything of the adjacent tier, plus the history of the machine’s signals, for example the last days of temperature or pressure values.',
  },
]

export const dataspacePath = (peerId) => (peerId ? `/dataspace?peer=${encodeURIComponent(peerId)}` : '/dataspace')

/** Policy actions on what a peer may access here, and the status each leads to. */
export const POLICY_ACTIONS = [
  { action: 'grant', label: 'Approve', status: 'granted' },
  { action: 'deny', label: 'Deny', status: 'denied' },
  { action: 'reset', label: 'Reset to default', status: 'default' },
]

/** What can be done with a capability in each status the gateway applies. */
const ACTIONS_BY_GATEWAY_STATUS = {
  auto: ['deny'],
  'on-request': ['grant', 'deny'],
  pending: ['grant', 'deny'],
  approved: ['deny', 'reset'],
  denied: ['grant', 'reset'],
}

/** The policy actions offered for a capability, by the gateway's status when known, else by ours. */
export function policyActionsFor(row) {
  const allowed = ACTIONS_BY_GATEWAY_STATUS[row.gatewayStatus]
  return allowed
    ? POLICY_ACTIONS.filter((a) => allowed.includes(a.action))
    : POLICY_ACTIONS.filter((a) => a.status !== row.status)
}
