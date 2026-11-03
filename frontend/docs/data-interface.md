# UI data interface

Screens obtain all data through this interface (`src/data`). A **data source** implements it. The mock source (`src/data/sources/mock`) is the default; a backend adapter implementing the same interface can be added later and selected with `VITE_DATA_SOURCE`, without changing any screen.

The operation list is defined in `src/data/interface.js` (`OPERATIONS`); result shapes of implemented operations are in `SHAPES` and checked by `tests/data/interface.test.js`. A new data source must pass those tests.

## Conventions

- Every operation is `async` and resolves with its result or rejects with a `DataError`.
- `DataError` has `area`, `kind` and `message`. Kinds:

  | Kind | Meaning |
  |---|---|
  | `unavailable` | The source or the system behind it cannot be reached, or the operation is not implemented yet |
  | `not_found` | The requested item does not exist |
  | `conflict` | The item is not in a state that allows the operation (for example acting on a finished run) |
  | `invalid` | The input was rejected |
  | `unauthorized` | Credentials or session are not valid |

- Live data uses `subscribeX(params, onEvent)`, which returns `unsubscribe()`. The source handles reconnection and polling; screens only see events. Failures arrive as `{ type: 'error', error }` events.
- Timestamps are ISO 8601 strings. Entity identifiers are NGSI-LD URIs.
- Status: **implemented** operations work on the mock source today; **planned** operations reject with `unavailable` until the change named in the heading implements them.

## session — implemented

| Operation | Input | Result | Errors |
|---|---|---|---|
| `getAuthConfig()` | — | `{ enabled, provider }`: whether sign-in is required and the identity provider's name | `unavailable` |
| `getSession()` | — | `{ valid, user: { username, name, email } \| null, factoryId, companyId }` | `unavailable` |
| `signIn({ username, password })` | credentials | the new session (as `getSession`) | `unauthorized` (wrong credentials), `unavailable` (provider unreachable) |
| `signOut()` | — | nothing | `unavailable` |
| `getFactory()` | — | `{ id, name, owner \| null, location: { city, country } \| null }` | `not_found`, `unavailable` |

## runs — implemented

| Operation | Input | Result | Errors |
|---|---|---|---|
| `listActiveRuns()` | — | `RunSummary[]`: `{ runId, incidentId \| null, machineId, issue, status, startedAt, updatedAt, escalationRef \| null }`, newest first | `unavailable` |
| `startRun({ machineId, issue })` | machine entity ID (or its short name) and issue text | `{ runId }` | `invalid`, `unavailable` |
| `getRun(runId)` | run ID | `Run` (below) | `not_found` |
| `subscribeRun(runId, onEvent)` | run ID, callback | `unsubscribe()`; events below | via `error` event |
| `clarify(runId, { text, files })` | clarification text, attached files | `{ status }` | `conflict`, `invalid` |
| `confirmResolution(runId, { confirmed, text, files })` | confirm, or reject with reason (required) and files | `{ status }` | `conflict`, `invalid` |
| `escalationPreflight(runId)` | run ID | `{ possible, reason \| null, recipient: { id, name } \| null, data: [{ label, category }], sharingTier }` | `not_found` |
| `escalate(runId)` | run ID; possible while the run is `awaiting_input` or `awaiting_confirmation` | `{ status, escalationRef }` | `conflict`, `unavailable` |
| `approveDataRequest(runId, { approved, note })` | decision on a data request beyond the sharing tier | `{ status }` | `conflict` |
| `replyToRecommendation(runId, { action, message })` | `resolved` \| `still_failing` \| `escalate` | `{ status }` | `conflict`, `invalid` |
| `sendConversationAct(runId, { act, outcome, text, inReplyTo })` | `inform`, `request`, `grant`, `deny`, `escalate` (ask for direct contact), `deescalate` (end direct contact), `close` (with `outcome`), `cancel` | `{ status, convState }` | `conflict`, `invalid` |
| `askAgent(runId, message)` | free text to the incident agent | `{ reply }` | `unavailable`, `conflict` |
| `getOutboxStatus(runId)` | run ID | `[{ messageId, status }]` delivery status (`pending`, `delivered`, `failed`) of sent messages | `not_found` |
| `refreshConversationStatus(runId)` | run ID | `{ status }` after checking whether the machine builder closed the conversation | `not_found` |
| `recordMachineBuilderClose(runId, { outcome, reason })` | close outcome and reason | `{ status }` | `conflict`, `invalid` |
| `reopenRun(runId)` | run ID | `{ status }` | `conflict` (not reopenable) |
| `stopRun(runId)` | run ID | `{ status }` | `conflict` |
| `archiveRun(runId)` | run ID of a finished run | nothing; the run becomes an incident | `not_found`, `conflict` (run still open) |

Operations on a run in a state that does not allow them reject with `conflict`.

**Run** (`getRun`, and the `run` of a `snapshot` event): the `RunSummary` fields plus

- `data`: state data of the current status (below);
- `steps[]`: completed steps `{ node, input, output, at }` in order;
- `escalation`: `{ ref, recipient: { id, name }, tier, data: [{ label, category }], sentAt }` once escalated, else `null`;
- `outbox`: `[{ messageId, status }]` as returned by `getOutboxStatus`;
- `reopenable`: whether `reopenRun` is possible.

**Run events** (`subscribeRun`): the first event is the run's current state; then, in order:

- `{ type: 'snapshot', run }`: the run's complete current state. Always the first event, and sent again after a lost connection was recovered; it replaces everything the screen knew about the run.
- `{ type: 'step', node, input, output, at }`: one per completed agent step. `node` is the step kind (for example `observe`, `hypothesize`, `validate`, `decide`, `act`, retrieval, `policy_check`, `clarification`, `resolution`, `escalate`, `suggest` or `message`); screens must accept unknown kinds and show them generically.
- `{ type: 'status', status, data, summary }`: a state change; `status` is one of `running`, `awaiting_input`, `awaiting_confirmation`, `awaiting_machine_builder`, `awaiting_operator_approval`, `awaiting_recommendation_review`, `mb_closed`, `completed`, `failed`, `stopped`; `data` carries what that state needs; `summary` is the run's `RunSummary` after the change (for example a newly assigned incident number).
- `{ type: 'connection', state: 'reconnecting' }`: the live connection was lost and the source is recovering it. Screens show that they are reconnecting; recovery is signalled by the next `snapshot`. A backend adapter emits this when its WebSocket drops and recovers with a reconnect plus a status poll.
- `{ type: 'error', error }`: the stream failed and could not be recovered (for example `not_found` for a run that is not active).

**State data** (`data`) per status:

| Status | `data` |
|---|---|
| `running` | `{}` |
| `awaiting_input` | `{ question, confidence, threshold }` |
| `awaiting_confirmation` | `{ rootCause, recommendedAction, confidence, rejected: [{ rootCause, recommendedAction, reason, at }] }` |
| `awaiting_machine_builder` | `{ escalationRef, builder }` |
| `awaiting_operator_approval` | `{ escalationRef, builder, requestId, text, tier, requested[], withinTier[], needsApproval[] }`; items are `{ label, category }` |
| `awaiting_recommendation_review` | `{ escalationRef, builder, summary, actions[] }` (actions in order) |
| `mb_closed` | `{ outcome, reason, reopenable, recordedBy: machine_builder \| operator }` |
| `completed` | `{ rootCause, recommendedAction, confidence, incidentLogged, resolvedBy? }` |
| `failed` | `{ error, node }` |
| `stopped` | `{ by, reason, reopenable, outcome? }` |

**Conversation.** The conversation with the machine builder is part of the step list: every message is a `message` step with output `{ messageId, sender: agent \| operator \| machine_builder, act, text, convState, inReplyTo?, outcome?, dataRequest?, recommendation?, internal? }`. `convState` is the conversation state after the message: `open`, `direct_contact_operator`, `direct_contact_machine_builder` or `closed`. `internal` messages (questions to the incident agent and its answers, notes) are never sent to the machine builder. Which acts are valid in which state is defined once in `src/data/conversationActs.js`, used by screens and data sources alike. `policy_check` steps record what was sent under which data-sharing tier and what was withheld; `suggest` steps carry the agent's suggested next acts `{ suggestions: [{ act, text }] }`.

**Attachments.** `clarify` and `confirmResolution` accept `files: [{ name, type, size, dataUrl }]`: files read in the browser, `dataUrl` holding the content as a data URL. Images, PDF and plain text; at most 5 files per submission and 10 MB per file, enforced by the UI. The mock keeps only `name`, `type` and `size`.

## incidents — implemented

| Operation | Input | Result | Errors |
|---|---|---|---|
| `listIncidents({ machineId, status, from, to })` | optional filters: machine entity ID, outcome(s), closing date range (`YYYY-MM-DD`, inclusive) | `IncidentSummary[]`: `{ id, number, machineId, issue, outcome, rootCause, escalated, escalationRef, startedAt, closedAt, reopenedRunId }`, newest first | `unavailable` |
| `getIncident(id)` | incident ID | `IncidentSummary` plus `decision`, `resolution`, `builder`, `escalation`, `conversation` (messages as above, with `at`) and `trace` (all steps with input and output) | `not_found` |
| `reopenIncident(id)` | incident ID | `{ runId }` of the new run; an escalated incident continues its conversation (`awaiting_machine_builder`), otherwise a new analysis starts | `conflict` (already reopened and still active) |

`outcome` is the final run status: `completed`, `failed`, `stopped` or `mb_closed`.

## entities — dashboard part implemented; rest planned (gh-3-ui-data-explorer-alerts)

| Operation | Input | Result | Errors |
|---|---|---|---|
| `getStats()` | — | `{ entityCount, typeCount, byType: [{ type, count }] }` | `unavailable` |
| `listTypes()` | — | type names | `unavailable` |
| `listAttributes()` | — | attribute names | `unavailable` |
| `queryEntities({ type, id, idPattern, filters, limit })` | query | NGSI-LD entities | `invalid`, `unavailable` |
| `getEntity(id)` | entity ID | NGSI-LD entity | `not_found` |
| `updateAttributes(id, attrs)` | attribute values | nothing | `not_found`, `invalid` |
| `appendAttributes(id, attrs)` | new attributes | nothing | `not_found`, `invalid` |
| `deleteAttribute(id, name, { subAttribute })` | attribute (or sub-attribute) | nothing | `not_found` |
| `deleteEntity(id)` | entity ID | nothing | `not_found` |
| `importEntities(entities)` | NGSI-LD entities | per-entity result | `invalid` |
| `fetchImportDocument(url)` | URL | the fetched document | `invalid`, `unavailable` |
| `deleteByTypes(types)` | type names | per-type count | `unavailable` |
| `getAttributeHistory(id, name, { from, to })` | entity, attribute, range | `[{ at, value }]` | `not_found` |
| `listTypesAt(at)` | past timestamp | type names at that time | `unavailable` |
| `queryEntitiesAt(at, query)` | past timestamp, query | entities as they were | `unavailable` |
| `subscribeEntities({ type }, onEvent)` | type filter, callback | `unsubscribe()`; `{ type: 'update', entityId, attributes }` events | via `error` event |
| `getLiveUpdateHealth()` | — | `{ status, detail }` | `unavailable` |
| `getValueHints({ entityType, attribute })` | entity type and attribute | suggested values | `unavailable` |

## alerts — counts implemented; rest planned (gh-3-ui-data-explorer-alerts)

| Operation | Input | Result | Errors |
|---|---|---|---|
| `listAlerts({ status, severity, environment, service, text, page })` | filters | `{ alerts, total }` | `unavailable` |
| `countAlerts({ status })` | optional status filter (default: open and acknowledged) | `{ total, bySeverity: { [severity]: count } }` | `unavailable` |
| `getAlert(id)` | alert ID | alert with history | `not_found` |
| `applyAlertAction(id, { action, text })` | `ack`, `unack`, `close`, `open`, `shelve`, `unshelve` | updated alert | `conflict` |
| `listEnvironments()` | — | environment names | `unavailable` |
| `listServices()` | — | service names | `unavailable` |

## dataspace — dashboard part implemented; rest planned (gh-3-ui-dataspace-system)

| Operation | Input | Result | Errors |
|---|---|---|---|
| `getConnection()` | — | `{ state: connected \| expired \| disconnected \| not_configured, participantId, expiresAt }` | `unavailable` |
| `connect({ secret })` | optional credential | connection | `unauthorized`, `unavailable` |
| `disconnect()` | — | nothing | `unavailable` |
| `listPeers()` | — | `[{ id, name, capabilities[] }]` compatible participants | `unavailable` (also when not connected) |
| `getPeerCapabilities(peerId)` | peer ID | capabilities in both directions | `not_found` |
| `listCapabilityRequests()` | — | incoming requests | `unavailable` |
| `decideCapabilityRequest(id, { approved, note })` | decision | updated request | `conflict` |
| `setCapabilityPolicy({ peerId, capability, action })` | policy change | nothing | `invalid` |
| `resolveNames(ids)` | registry IDs | `{ [id]: name }` | `unavailable` |
| `resolveBuilders(machineIds)` | machine entity IDs | `{ [machineId]: builderName }` | `unavailable` |

## knowledgeBase — planned (gh-3-ui-dataspace-system)

| Operation | Input | Result | Errors |
|---|---|---|---|
| `listDocuments({ pipeline })` | ingestion pipeline | documents with status, date, chunks, description | `unavailable` |
| `uploadDocument({ file, pipeline })` | file and pipeline | `{ jobId }` | `invalid` |
| `getIngestJob(jobId)` | job ID | `{ status: queued \| processing \| done \| failed, progress, error }` | `not_found` |
| `updateDescription(name, description)` | document and text | nothing | `not_found` |
| `deleteDocument(name)` | document | nothing | `not_found` |
| `query({ text, pipeline })` | test query | ranked passages with source | `unavailable` |

## system — health implemented; rest planned (gh-3-ui-dataspace-system)

| Operation | Input | Result | Errors |
|---|---|---|---|
| `getHealth()` | — | `{ overall, checkedAt, checks: [{ id, label, status, latencyMs, detail }] }`; statuses `ok`, `degraded`, `error`, `unknown` | `unavailable` |
| `getServiceSettings()` | — | service settings | `unavailable` |
| `saveServiceSettings(settings)` | settings | saved settings | `invalid` |
