/**
 * UI data interface: the operations screens may use, per area, and the
 * shapes of their results. Every data source implements this interface;
 * screens never depend on a particular source. Full documentation:
 * frontend/docs/data-interface.md.
 *
 * Conventions
 * - Every operation is async and resolves with its result or rejects with a
 *   DataError (see errors.js).
 * - Live data uses subscribe operations: `subscribeX(params, onEvent)`
 *   returns an `unsubscribe()` function. Reconnection and polling are the
 *   source's responsibility and invisible to screens.
 */

/** Interface areas and their operations. */
export const OPERATIONS = {
  session: ['getAuthConfig', 'getSession', 'signIn', 'signOut', 'getFactory'],
  runs: [
    'listActiveRuns', 'startRun', 'getRun', 'subscribeRun', 'clarify', 'confirmResolution',
    'escalationPreflight', 'escalate', 'approveDataRequest', 'replyToRecommendation',
    'sendConversationAct', 'askAgent', 'getOutboxStatus', 'refreshConversationStatus',
    'recordMachineBuilderClose', 'reopenRun', 'stopRun', 'archiveRun',
  ],
  incidents: ['listIncidents', 'getIncident', 'reopenIncident'],
  entities: [
    'getStats', 'listTypes', 'listAttributes', 'queryEntities', 'getEntity', 'updateAttributes',
    'appendAttributes', 'deleteAttribute', 'deleteEntity', 'importEntities', 'fetchImportDocument',
    'deleteByTypes', 'getAttributeHistory', 'listTypesAt', 'queryEntitiesAt', 'subscribeEntities',
    'getLiveUpdateHealth', 'getValueHints',
  ],
  alerts: ['listAlerts', 'countAlerts', 'getAlert', 'applyAlertAction', 'listEnvironments', 'listServices'],
  dataspace: [
    'getConnection', 'connect', 'disconnect', 'listPeers', 'getPeerCapabilities',
    'listCapabilityRequests', 'decideCapabilityRequest', 'setCapabilityPolicy', 'resolveNames', 'resolveBuilders',
  ],
  knowledgeBase: ['listDocuments', 'uploadDocument', 'getIngestJob', 'updateDescription', 'deleteDocument', 'query'],
  system: ['getHealth', 'getServiceSettings', 'saveServiceSettings'],
}

export const AREAS = Object.keys(OPERATIONS)

/** Every run state the UI represents. */
export const RUN_STATES = [
  'running', 'awaiting_input', 'awaiting_confirmation', 'awaiting_machine_builder',
  'awaiting_operator_approval', 'awaiting_recommendation_review', 'mb_closed',
  'completed', 'failed', 'stopped',
]

export const CONNECTION_STATES = ['connected', 'expired', 'disconnected', 'not_configured']
export const HEALTH_STATES = ['ok', 'degraded', 'error', 'unknown']

/**
 * @typedef {Object} AuthConfig
 * @property {boolean} enabled   Whether operators must sign in.
 * @property {string} provider   Human-readable name of the identity provider.
 *
 * @typedef {Object} User
 * @property {string} username
 * @property {string} name
 * @property {string} email
 *
 * @typedef {Object} Session
 * @property {boolean} valid
 * @property {User|null} user
 * @property {string|null} factoryId
 * @property {string|null} companyId
 *
 * @typedef {Object} Factory
 * @property {string} id
 * @property {string} name
 * @property {string|null} owner
 * @property {{city: string, country: string}|null} location
 *
 * @typedef {Object} RunSummary
 * @property {string} runId
 * @property {number|null} incidentId
 * @property {string} machineId    Entity ID of the affected machine.
 * @property {string} issue
 * @property {string} status       One of RUN_STATES.
 * @property {string} startedAt    ISO 8601.
 * @property {string} updatedAt    ISO 8601.
 *
 * @typedef {Object} AlertCounts
 * @property {number} total
 * @property {Object<string, number>} bySeverity
 *
 * @typedef {Object} EntityStats
 * @property {number} entityCount
 * @property {number} typeCount
 * @property {{type: string, count: number}[]} byType  Sorted by count, descending.
 *
 * @typedef {Object} Connection
 * @property {string} state              One of CONNECTION_STATES.
 * @property {string|null} participantId
 * @property {string|null} expiresAt     ISO 8601.
 *
 * @typedef {Object} Peer
 * @property {string} id
 * @property {string} name
 * @property {string[]} capabilities
 *
 * @typedef {Object} HealthCheck
 * @property {string} id
 * @property {string} label
 * @property {string} status          One of HEALTH_STATES.
 * @property {number|null} latencyMs
 * @property {string|null} detail
 *
 * @typedef {Object} Health
 * @property {string} overall         One of HEALTH_STATES.
 * @property {string} checkedAt       ISO 8601.
 * @property {HealthCheck[]} checks
 */

const user = { username: 'string', name: 'string', email: 'string' }

/** Result shapes of implemented operations, checked by the data-interface tests. */
export const SHAPES = {
  session: {
    getAuthConfig: { enabled: 'boolean', provider: 'string' },
    getSession: { valid: 'boolean', user: { $optional: user }, factoryId: '?string', companyId: '?string' },
    signIn: { valid: 'boolean', user: { $optional: user }, factoryId: '?string', companyId: '?string' },
    signOut: { $optional: {} },
    getFactory: { id: 'string', name: 'string', owner: '?string', location: { $optional: { city: 'string', country: 'string' } } },
  },
  runs: {
    listActiveRuns: [{
      runId: 'string', incidentId: '?number', machineId: 'string', issue: 'string',
      status: { $enum: RUN_STATES }, startedAt: 'date', updatedAt: 'date',
    }],
  },
  alerts: {
    countAlerts: { total: 'number', bySeverity: { $record: 'number' } },
  },
  entities: {
    getStats: { entityCount: 'number', typeCount: 'number', byType: [{ type: 'string', count: 'number' }] },
  },
  dataspace: {
    getConnection: { state: { $enum: CONNECTION_STATES }, participantId: '?string', expiresAt: '?date' },
    listPeers: [{ id: 'string', name: 'string', capabilities: ['string'] }],
  },
  system: {
    getHealth: {
      overall: { $enum: HEALTH_STATES },
      checkedAt: 'date',
      checks: [{ id: 'string', label: 'string', status: { $enum: HEALTH_STATES }, latencyMs: '?number', detail: '?string' }],
    },
  },
}
