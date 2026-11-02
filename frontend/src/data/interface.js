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

/** Delivery states of messages the operator sent to the machine builder. */
export const DELIVERY_STATES = ['pending', 'delivered', 'failed']

/** Final run states an archived run (incident) can have. */
export const INCIDENT_OUTCOMES = ['completed', 'failed', 'stopped', 'mb_closed']

export const CONNECTION_STATES = ['connected', 'expired', 'disconnected', 'not_configured']

/** Alert statuses, and the actions `applyAlertAction` accepts. */
export const ALERT_STATUSES = ['open', 'ack', 'shelved', 'closed', 'expired', 'blackout', 'unknown']
export const ALERT_ACTIONS = ['ack', 'unack', 'shelve', 'unshelve', 'close', 'open']

/** Health of live entity updates, and per-entity results of an import. */
export const LIVE_UPDATE_STATES = ['ok', 'unavailable']
export const IMPORT_RESULTS = ['created', 'updated', 'failed']
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
 * @property {string|null} escalationRef  Reference of the escalation to the machine builder.
 *
 * @typedef {Object} RunStep
 * @property {string} node         Step kind (observe, hypothesize, validate, decide, act,
 *                                 retrieval, policy_check, message, …); unknown kinds are valid.
 * @property {Object|null} input   What the step worked on.
 * @property {Object} output       Structured output of the step.
 * @property {string} at           ISO 8601 completion time.
 *
 * @typedef {Object} Run           RunSummary plus:
 * @property {Object} data         State data of the current status (see data-interface.md).
 * @property {RunStep[]} steps     Completed steps in order; conversation messages are `message` steps.
 * @property {Object|null} escalation  `{ ref, recipient: { id, name }, tier, data[], sentAt }` once escalated.
 * @property {{messageId: string, status: string}[]} outbox  Delivery state of operator messages.
 * @property {boolean} reopenable
 *
 * @typedef {Object} IncidentSummary
 * @property {string} id
 * @property {number} number
 * @property {string} machineId
 * @property {string} issue
 * @property {string} outcome      One of INCIDENT_OUTCOMES.
 * @property {string|null} rootCause
 * @property {boolean} escalated
 * @property {string|null} escalationRef
 * @property {string} startedAt
 * @property {string} closedAt
 * @property {string|null} reopenedRunId  Active run the incident was reopened as.
 *
 * @typedef {Object} Incident      IncidentSummary plus decision, resolution, builder,
 *                                 escalation, conversation (messages) and trace (RunStep[]).
 *
 * @typedef {Object} AlertCounts
 * @property {number} total
 * @property {Object<string, number>} bySeverity
 *
 * @typedef {Object} Entity     NGSI-LD entity (compacted terms): `id`, `type` and one
 *                                 member per attribute, e.g. `{ type: 'Property', value,
 *                                 unitCode?, observedAt?, datasetId?, <sub-attributes> }`,
 *                                 `{ type: 'Relationship', object }`, `GeoProperty`,
 *                                 `JsonProperty` (`json`), `LanguageProperty` (`languageMap`),
 *                                 `ListProperty` (`valueList`), `VocabularyProperty` (`vocab`).
 *
 * @typedef {Object} Alert
 * @property {string} id
 * @property {string} resource     Entity ID of the affected machine.
 * @property {string} event
 * @property {string} text
 * @property {string} severity
 * @property {string} status       One of ALERT_STATUSES.
 * @property {string} environment
 * @property {string[]} service
 * @property {string} createTime   ISO 8601.
 * @property {{at: string, type: string, status: string, text: string, user: string|null}[]} history
 *                                 Only in `getAlert` and `applyAlertAction` results.
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

const runSummary = {
  runId: 'string', incidentId: '?number', machineId: 'string', issue: 'string',
  status: { $enum: RUN_STATES }, startedAt: 'date', updatedAt: 'date', escalationRef: '?string',
}
const step = { node: 'string', input: { $optional: {} }, output: {}, at: 'date' }
const outbox = [{ messageId: 'string', status: { $enum: DELIVERY_STATES } }]
const run = {
  ...runSummary,
  data: {},
  steps: [step],
  escalation: { $optional: { ref: 'string', recipient: { id: 'string', name: 'string' }, tier: 'string', data: [{ label: 'string', category: 'string' }], sentAt: 'date' } },
  outbox,
  reopenable: 'boolean',
}
const status = { status: { $enum: RUN_STATES } }
const incidentSummary = {
  id: 'string', number: 'number', machineId: 'string', issue: 'string', outcome: { $enum: INCIDENT_OUTCOMES },
  rootCause: '?string', escalated: 'boolean', escalationRef: '?string', startedAt: 'date', closedAt: 'date', reopenedRunId: '?string',
}
const entity = { id: 'string', type: 'string' }
const alertSummary = {
  id: 'string', resource: 'string', event: 'string', text: 'string', severity: 'string',
  status: { $enum: ALERT_STATUSES }, environment: 'string', service: ['string'], group: '?string',
  value: '?string', origin: '?string', createTime: 'date', lastReceiveTime: 'date', duplicateCount: 'number',
}
const alertDetail = {
  ...alertSummary,
  attributes: { $optional: {} },
  history: [{ at: 'date', type: 'string', status: { $enum: ALERT_STATUSES }, text: 'string', user: '?string' }],
}
const nothing = { $optional: {} }
const message = { messageId: 'string', sender: { $enum: ['agent', 'operator', 'machine_builder'] }, act: 'string', text: 'string', convState: 'string', at: 'date' }

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
    listActiveRuns: [runSummary],
    startRun: { runId: 'string' },
    getRun: run,
    clarify: status,
    confirmResolution: status,
    escalationPreflight: {
      possible: 'boolean', reason: '?string', recipient: { $optional: { id: 'string', name: 'string' } },
      data: [{ label: 'string', category: 'string' }], sharingTier: 'string',
    },
    escalate: { ...status, escalationRef: 'string' },
    approveDataRequest: status,
    replyToRecommendation: status,
    sendConversationAct: { ...status, convState: 'string' },
    askAgent: { reply: 'string' },
    getOutboxStatus: outbox,
    refreshConversationStatus: status,
    recordMachineBuilderClose: status,
    reopenRun: status,
    stopRun: status,
    archiveRun: { $optional: {} },
  },
  incidents: {
    listIncidents: [incidentSummary],
    getIncident: {
      ...incidentSummary,
      decision: { $optional: { rootCause: 'string', recommendedAction: 'string', confidence: 'number' } },
      resolution: '?string',
      builder: '?string',
      conversation: [message],
      trace: [step],
    },
    reopenIncident: { runId: 'string' },
  },
  alerts: {
    listAlerts: { alerts: [alertSummary], total: 'number', bySeverity: { $record: 'number' }, page: 'number', pageSize: 'number' },
    countAlerts: { total: 'number', bySeverity: { $record: 'number' } },
    getAlert: alertDetail,
    applyAlertAction: alertDetail,
    listEnvironments: ['string'],
    listServices: ['string'],
  },
  entities: {
    getStats: { entityCount: 'number', typeCount: 'number', byType: [{ type: 'string', count: 'number' }] },
    listTypes: ['string'],
    listAttributes: ['string'],
    queryEntities: [entity],
    getEntity: entity,
    updateAttributes: nothing,
    appendAttributes: nothing,
    deleteAttribute: nothing,
    deleteEntity: nothing,
    importEntities: [{ id: '?string', result: { $enum: IMPORT_RESULTS }, reason: '?string' }],
    fetchImportDocument: { url: 'string' },
    deleteByTypes: [{ type: 'string', count: 'number' }],
    getAttributeHistory: [{ at: 'date' }],
    listTypesAt: ['string'],
    queryEntitiesAt: [entity],
    getLiveUpdateHealth: { status: { $enum: LIVE_UPDATE_STATES }, detail: '?string' },
    getValueHints: ['string'],
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
