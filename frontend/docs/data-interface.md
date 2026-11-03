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
| `escalate(runId)` | run ID | `{ status, escalationRef }` | `conflict`, `unavailable` |
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

## entities — implemented

Entities are NGSI-LD entities in compacted form: `id`, `type` and one member per attribute. Attribute kinds: `Property` (`value`), `Relationship` (`object`), `GeoProperty` (`value` as GeoJSON), `JsonProperty` (`json`), `LanguageProperty` (`languageMap`), `ListProperty` (`valueList`), `VocabularyProperty` (`vocab`); a `Property` whose value is `{ "@id": iri }` is IRI-valued. Attributes may carry `unitCode`, `observedAt`, `datasetId` and sub-attributes (members that are attributes themselves). The data source returns terms and IRIs as the broker does; the UI performs no JSON-LD expansion.

| Operation | Input | Result | Errors |
|---|---|---|---|
| `getStats()` | — | `{ entityCount, typeCount, byType: [{ type, count }] }` | `unavailable` |
| `listTypes()` | — | type names, sorted | `unavailable` |
| `listAttributes()` | — | attribute names, sorted | `unavailable` |
| `queryEntities({ type, id, idPattern, q, limit })` | type(s) and ID(s) (comma-separated), ID regular expression, NGSI-LD query expression `q`, result limit 1–1000 (default 100) | entities | `invalid` (with the reason), `unavailable` |
| `getEntity(id)` | entity ID | entity | `not_found` |
| `updateAttributes(id, attrs)` | `{ [name]: fragment }`; each fragment is merged into the existing attribute (`{ value }` changes the value and, unless the fragment sets `observedAt`, stamps the observation time; an attribute-valued member adds or replaces a sub-attribute) | nothing | `not_found` (entity or attribute), `invalid` (with the reason, e.g. text for a numeric value) |
| `appendAttributes(id, attrs)` | `{ [name]: attribute }` new attributes | nothing | `not_found`, `conflict` (name exists), `invalid` |
| `deleteAttribute(id, name, { subAttribute })` | attribute, or one of its sub-attributes | nothing | `not_found` |
| `deleteEntity(id)` | entity ID | nothing | `not_found` |
| `importEntities(entities)` | list of entities; existing IDs are updated (attributes merged) | `[{ id, result: created \| updated \| failed, reason }]` per entity | `invalid` (not a list) |
| `fetchImportDocument(url)` | http(s) URL | `{ url, document }`: the parsed JSON document | `invalid` (not a URL), `unavailable` (cannot be fetched) |
| `deleteByTypes(types)` | type names | `[{ type, count }]` deleted per type | `unavailable` |
| `getAttributeHistory(id, name, { from, to })` | entity, attribute, ISO range (default: all) | `[{ at, value }]` oldest first; empty if nothing was recorded in the range | `not_found`, `invalid` |
| `listTypesAt(at)` | past ISO timestamp | type names at that moment | `invalid` (not in the past), `unavailable` |
| `queryEntitiesAt(at, query)` | past ISO timestamp, query as `queryEntities` | entities as they were at that moment | `invalid`, `unavailable` |
| `subscribeEntities({ type, ids }, onEvent)` | optional type or entity IDs, callback | `unsubscribe()`; events `{ type: 'update', entityId, attributes: { [name]: attribute } }` with the changed attributes | via `{ type: 'error', error }`; after an error no further events arrive |
| `getLiveUpdateHealth()` | — | `{ status: ok \| unavailable, detail }`: whether live updates can be delivered | `unavailable` |
| `getValueHints({ entityType, attribute })` | entity type and attribute | suggested values from the data model (may be empty) | `unavailable` |

**Query expression (`q`).** The operators `==`, `!=`, `>`, `>=`, `<`, `<=`, `~=` (regular expression), `!~=`, `attr` (exists) and `!attr` (does not exist), combined with `;` (and, binds tighter) and `|` (or) and parentheses. Paths: `attr`, `attr.subAttribute`, `attr[key]` (member of an object value). Values: `"text"`, numbers, `true`/`false`, ranges `1..5`, lists `"a","b"`, unquoted identifiers or dates. Relationships compare their `object`, list and language attributes match if any element matches. A syntax error rejects the query as `invalid` with the position.

**Live updates.** A screen subscribes while it shows live data and polls `getLiveUpdateHealth()` to show whether updates work; after an `error` event it resubscribes once the health is `ok` again.

**Mock specifics.**

- *History:* sensor `value` attributes have a value every 5 minutes and machine `status` attributes one every 2 hours, for the 7 days before the mock data was created and up to now. They are computed on demand from the entity ID and the time, so they are the same on every load. Other attributes have no history.
- *Time-shift is an approximation:* the mock knows when entities were created (seed entities: long ago; imported ones: at import) and deleted (seed: one sensor and one camera deleted a day earlier; plus deletions in the session). For a past moment it hides entities created later, includes entities deleted later, and takes `value`/`status` from the history; all other attributes show their current values, and attribute edits are not versioned.
- *Live updates:* every 5 s divided by the playback speed of the mock data controls, sensor values change slightly (the subscribed entities, or three sensors per interval in turn). The controls' *Live entity updates* setting, or a failure of the `entities` area, makes live updates unavailable.
- *Import from URL:* the mock makes no network requests. It serves these sample documents and reports every other URL as `unavailable`:
  - `https://samples.example.org/ngsi-ld/line-d.json`: a new production line with a machine and a sensor (created);
  - `https://samples.example.org/ngsi-ld/machine-names.json`: new names for two laser cutters (updated);
  - `https://samples.example.org/ngsi-ld/incomplete.json`: an entity without a type (the preview reports it).
- *Value hints:* machine `status`, `operatingMode` and `machineType`, and line `shifts`.

## alerts — implemented

| Operation | Input | Result | Errors |
|---|---|---|---|
| `listAlerts({ status, severity, environment, service, text, sort, page, pageSize })` | status(es) (default `open`, `ack`), severity(ies), environment, service, free text (ID, resource, event, text, value, service), `sort`: `severity` (default: most severe, then newest) or `time` (newest first), page (from 1) and page size (default 50) | `{ alerts, total, bySeverity, page, pageSize }`: one page of alert summaries (without history), the total number matching, and the number per severity for the same filter without the severity filter | `unavailable` |
| `countAlerts({ status })` | optional status filter (default: open and acknowledged) | `{ total, bySeverity: { [severity]: count } }` | `unavailable` |
| `getAlert(id)` | alert ID | alert with `history` | `not_found` |
| `applyAlertAction(id, { action, text })` | `ack`, `unack`, `close`, `open` (reopen), `shelve`, `unshelve`; optional note | updated alert with `history` | `not_found`, `conflict` (action does not fit the status, e.g. acknowledging an acknowledged alert), `invalid` |
| `listEnvironments()` | — | environment names | `unavailable` |
| `listServices()` | — | service names | `unavailable` |

**Alert:** `{ id, resource (entity ID), event, text, severity, status, environment, service[], group, value, origin, type, createTime, lastReceiveTime, duplicateCount, attributes }`; `getAlert` and `applyAlertAction` add `history: [{ at, type: new \| status \| note, status, severity, text, user }]`, oldest first. Statuses: `open`, `ack` (acknowledged), `shelved`, `closed` (also `expired`, `blackout`, `unknown` from an alert manager). Actions: `ack` open → ack, `unack` ack → open, `shelve` open/ack → shelved, `unshelve` shelved → open, `close` open/ack/shelved → closed, `open` closed → open. There is no bulk operation; screens apply an action to each selected alert.

**Mock specifics.** Sixteen seeded alerts on the factory's machines in the environments *Production* and *Commissioning*. In development, while the Alerts area lists alerts, a new alert is raised about every 60 s divided by the playback speed; the controls' *Raise new alerts occasionally* setting switches this off.

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
