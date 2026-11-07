# UI data interface

Screens obtain all data through this interface (`src/data`). A **data source** implements it, and `VITE_DATA_SOURCE` selects it without changing any screen:
- `mock` (default, `src/data/sources/mock`): everything in the browser;
- `backend` (`src/data/sources/backend`): the operations the backend provides, with every other operation delegated to the mock (see [Backend source](#backend-source)).

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
- Status: every operation is **implemented** on the mock source. An operation a data source does not implement rejects with `unavailable`.

## Backend source

Served by the backend (phase 1):

| Area | Operations | Backend |
|---|---|---|
| runs | `listActiveRuns`, `startRun`, `getRun`, `subscribeRun`, `clarify`, `confirmResolution`, `escalationPreflight`, `reopenRun`, `stopRun`, `archiveRun` | `/api/agent/…`, `/ws/run/{runId}` |
| incidents | `listIncidents`, `getIncident`, `reopenIncident` | `/api/incidents` |
| session | `getAuthConfig`, `getSession`, `signIn`, `signOut` | `/api/auth/config`, `status`, `connect`, `logout` |
| entities | `getStats`, `listTypes`, `listAttributes`, `queryEntities`, `getEntity`, `updateAttributes`, `appendAttributes`, `deleteAttribute`, `deleteEntity`, `importEntities`, `fetchImportDocument`, `deleteByTypes`, `getAttributeHistory`, `getAttributeStatus`, `listTypesAt`, `queryEntitiesAt`, `subscribeEntities`, `getLiveUpdateHealth`, `getValueHints` | `/api/ngsi/…`, `/api/ngsi/ws`, `/api/shacl/hints` |
| alerts | `listAlerts`, `countAlerts`, `getAlert`, `applyAlertAction`, `listEnvironments`, `listServices`, `getAlertSettings` | `/api/alerta/…` |
| system | `getHealth` | `/api/diagnostics` |

Every other operation (the factory details in `session.getFactory`, dataspace, the optional knowledge base, service settings, and the escalation and conversation operations of runs) comes from the mock, so the whole UI stays usable. `src/data/sources/backend/index.js` builds each area as `{ ...mock[area], ...backend[area] }` and lists the served operations in `SERVED`; the mock's development controls still apply to the delegated operations.

- **Stopped backend:** until the backend has answered, `getAuthConfig` reports `backendUnreachable: true` and sign-in as off, so the app opens and each area shows its own state. The session gate checks again every 10 seconds, and applies the real configuration when the backend answers. Once the backend has answered, a failed `getAuthConfig` or `getSession` stays `unavailable`.
- **Transport:** relative paths (`/api/…`, `/ws/…`), so the development server's proxy reaches the backend (`XANA_BACKEND_URL`). `VITE_BACKEND_BASE` sets another prefix or origin. Requests time out after 15 s.
- **Keys:** the backend uses snake_case; keys are converted both ways, recursively, including step input and output and state data. Values are never changed. Attached files are sent as `{ name, type, size, data_url }`. Answers holding attribute names are not converted: names are data, and `max_temp` stays `max_temp`.
- **Errors:** a backend refusal keeps its kind and message. Without one, HTTP 401/403 map to `unauthorized`, 404 to `not_found`, 409 to `conflict`, 422 to `invalid`, anything else to `unavailable`. A backend that cannot be reached or does not answer is `unavailable`, in the calling area only.
- **Run stream:** the WebSocket's first message is the snapshot. A lost connection emits `{ type: 'connection', state: 'reconnecting' }` and reconnects after 0.5, 1, 2, 4 and then every 8 s; the new snapshot replaces the screen's state. An unknown or archived run (an `error` event, or close code 4404) ends the stream with `not_found`; a stream that never opened ends with `unavailable`, and the screen offers a retry. `keepalive` messages are not forwarded.
- **Explorer:** on the backend source, names are what the broker gives: full IRIs on platform data, unless the backend's `NGSI_CONTEXT_URL` maps them. Patterns use RE2, so look-around and back-references are refused as `invalid`. An expression the broker can't evaluate is evaluated by the backend over the first 5000 entities, and the list's `limited` says when there were more. `importEntities` fails an entity whose `@context` isn't the core context, `NGSI_CONTEXT_URL` or in `NGSI_ALLOWED_CONTEXTS`. `getAttributeHistory` gives an empty list for an unknown entity, as the history store can't tell it from one without rows, so its `not_found` doesn't occur. Points of an attribute with several datasets also have `datasetId`. A service behind the backend that is stopped or failing gives `unavailable`, and the message names it.
- **Live updates:** `subscribeEntities` opens `/api/ngsi/ws`. Its stream ends with one `error` event of kind `unavailable`, for example when the backend closes a client that fell behind (code 1013); screens resubscribe when `getLiveUpdateHealth` is `ok` again. `getLiveUpdateHealth` also has `state`, `expiresAt` and `delivery` (`confirmed` once a change has arrived, `unconfirmed` until then). `ok` means connected and subscribed. The context broker reports nothing about failed MQTT deliveries, so a broken path between it and MQTT shows only when a change made through this backend doesn't arrive within 15 s (`delivery_failed`). An `update` holds the whole entity as the broker notifies it, so screens compare to see what changed. Changes during an outage aren't replayed, so screens read what they show again after resubscribing. Deleted entities aren't notified.
- **Alerts:** answers aren't key-mapped, as an alert's `attributes` are data. A search covers up to 1000 alerts of the other filters. `searchLimited` says when there were more, `searched` how many were looked at, and then `total` and `bySeverity` count only those; the screen says so. Severities are Alerta's, which on the platform include `up` and `down`. Alerta failing or refusing its key gives `unavailable`, with a message naming it.
- **Phase 1 limits:** `escalationPreflight` answers that escalation is not possible, with the backend's reason; `reopenRun` rejects with `conflict`.
- **Shapes:** `tests/data/backendShapes.test.js` checks every served operation against `SHAPES` with answers recorded from a real backend (`tests/data/backend-fixtures/`, recorded with `scripts/record-backend-fixtures.mjs`).

## session — implemented

| Operation | Input | Result | Errors |
|---|---|---|---|
| `getAuthConfig()` | — | `{ enabled, provider, backendUnreachable? }`: whether sign-in is required, the identity provider's name, and, on the backend source, that the backend has not answered yet | `unavailable` |
| `getSession()` | — | `{ valid, user: { username, name, email } \| null, factoryId, companyId, tokenExpiresInS }`; `tokenExpiresInS` is the time left on the current token, or `null` | `unavailable` |
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

On the backend source, the output of an `observe` step holds `alerts`: `[{ id, resource, event, severity, status, text, value, service, environment, lastReceived, ageHours, weight }]`, highest weight first.

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
| `queryEntities({ type, id, idPattern, q, limit })` | type(s) and ID(s) (comma-separated), ID regular expression, NGSI-LD query expression `q`, result limit 1–1000 (default 100) | entities; if a search stopped early, the list also has `limited: { scanned, total }` and screens say so | `invalid` (with the reason), `unavailable` |
| `getEntity(id)` | entity ID | entity | `not_found` |
| `updateAttributes(id, attrs)` | `{ [name]: fragment }`; each fragment is merged into the existing attribute (`{ value }` changes the value and, unless the fragment sets `observedAt`, stamps the observation time; an attribute-valued member adds or replaces a sub-attribute) | nothing | `not_found` (entity or attribute), `invalid` (with the reason, e.g. text for a numeric value) |
| `appendAttributes(id, attrs)` | `{ [name]: attribute }` new attributes | nothing | `not_found`, `conflict` (name exists), `invalid` |
| `deleteAttribute(id, name, { subAttribute })` | attribute, or one of its sub-attributes | nothing | `not_found` |
| `deleteEntity(id)` | entity ID | nothing | `not_found` |
| `importEntities(entities)` | list of entities; existing IDs are updated (attributes merged) | `[{ id, result: created \| updated \| failed, reason }]` per entity | `invalid` (not a list) |
| `fetchImportDocument(url)` | http(s) URL | `{ url, document }`: the parsed JSON document | `invalid` (not a URL, an internal address, a URL with credentials, too large, or not JSON), `unavailable` (cannot be fetched) |
| `deleteByTypes(types)` | type names | `[{ type, count }]` deleted per type | `unavailable` |
| `getAttributeHistory(id, name, { from, to })` | entity, attribute, ISO range (default: all) | `[{ at, value }]` oldest first; empty if nothing was recorded in the range. If only the newest values fit, the list also has `limited: { newest }` | `not_found`, `invalid` |
| `getAttributeStatus(id)` | entity ID | `{ [name]: { deleted, observedAt } }`: the latest recorded state per attribute, also of attributes that no longer exist; `{}` if nothing was recorded | `unavailable` |
| `listTypesAt(at)` | past ISO timestamp | type names at that moment | `invalid` (not in the past), `unavailable` |
| `queryEntitiesAt(at, query)` | past ISO timestamp, query as `queryEntities` | entities as they were at that moment | `invalid`, `unavailable` |
| `subscribeEntities({ type, ids }, onEvent)` | optional type or entity IDs, callback | `unsubscribe()`; events `{ type: 'update', entityId, attributes: { [name]: attribute } }` with the changed attributes, and perhaps others that didn't change | via `{ type: 'error', error }`; after an error no further events arrive |
| `getLiveUpdateHealth()` | — | `{ status: ok \| unavailable, detail }`: whether live updates can be delivered | `unavailable` |
| `getValueHints({ entityType, attribute })` | entity type and attribute | `{ hintType: enum \| range \| datatype \| none, values, minimum, maximum, minimumExclusive, maximumExclusive, datatype, detail }`: allowed values and range from the data model. `none` when nothing is known or it can't be read, and then `detail` says why | `unavailable` |

**Query expression (`q`).** The operators `==`, `!=`, `>`, `>=`, `<`, `<=`, `~=` (regular expression), `!~=`, `attr` (exists) and `!attr` (does not exist), combined with `;` (and, binds tighter) and `|` (or) and parentheses. Paths: `attr`, `attr.subAttribute`, `attr[key]` (member of an object value). Values: `"text"`, numbers, `true`/`false`, ranges `1..5`, lists `"a","b"`, unquoted identifiers or dates. Relationships compare their `object`, list and language attributes match if any element matches. A pattern for `~=` and `!~=` is the text as written, also unquoted: `serial~=20` finds `M20-A`, and `serial~="M","Z"` matches either. A syntax error rejects the query as `invalid` with the position.

**Live updates.** A screen subscribes while it shows live data and polls `getLiveUpdateHealth()` to show whether updates work; after an `error` event it resubscribes once the health is `ok` again.

**Mock specifics.**

- *History:* sensor `value` attributes have a value every 5 minutes and machine `status` attributes one every 2 hours, for the 7 days before the mock data was created and up to now. They are computed on demand from the entity ID and the time, so they are the same on every load. Other attributes have no history.
- *Time-shift is an approximation:* the mock knows when entities were created (seed entities: long ago; imported ones: at import) and deleted (seed: one sensor and one camera deleted a day earlier; plus deletions in the session). For a past moment it hides entities created later, includes entities deleted later, and takes `value`/`status` from the history; all other attributes show their current values, and attribute edits are not versioned.
- *Live updates:* every 5 s divided by the playback speed of the mock data controls, sensor values change slightly (the subscribed entities, or three sensors per interval in turn). The controls' *Live entity updates* setting, or a failure of the `entities` area, makes live updates unavailable.
- *Search limit:* the controls' `searchCap` makes entity and alert searches stop after that many items and say so, as the backend does on a large installation. Off by default.
- *Import from URL:* the mock makes no network requests. It serves these sample documents and reports every other URL as `unavailable`:
  - `https://samples.example.org/ngsi-ld/line-d.json`: a new production line with a machine and a sensor (created);
  - `https://samples.example.org/ngsi-ld/machine-names.json`: new names for two laser cutters (updated);
  - `https://samples.example.org/ngsi-ld/incomplete.json`: an entity without a type (the preview reports it).
- *Value hints:* machine `status`, `operatingMode` and `machineType`, and line `shifts`; a range for sensor `value`, and a data type for machine `manufacturer`.

## alerts — implemented

| Operation | Input | Result | Errors |
|---|---|---|---|
| `listAlerts({ status, severity, environment, service, text, sort, page, pageSize })` | status(es) (default `open`, `ack`), severity(ies), environment, service, free text (ID, resource, event, text, value, service), `sort`: `severity` (default: most severe, then newest) or `time` (newest first), page (from 1) and page size (default 50) | `{ alerts, total, bySeverity, page, pageSize, searchLimited?, searched? }`: one page of alert summaries (without history), the total number matching, and the number per severity for the same filter without the severity filter; with `text`, whether the search stopped early, and how many it looked at | `unavailable` |
| `countAlerts({ status })` | optional status filter (default: open and acknowledged) | `{ total, bySeverity: { [severity]: count } }` | `unavailable` |
| `getAlert(id)` | alert ID | alert with `history` | `not_found` |
| `applyAlertAction(id, { action, text })` | `ack`, `unack`, `close`, `open` (reopen), `shelve`, `unshelve`; optional note | updated alert with `history` | `not_found`, `conflict` (action does not fit the status, e.g. acknowledging an acknowledged alert), `invalid` |
| `listEnvironments()` | — | environment names | `unavailable` |
| `listServices()` | — | service names | `unavailable` |
| `getAlertSettings()` | — | `{ refreshIntervalS }`: the automatic refresh interval until the operator chooses another | `unavailable` |

**Alert:** `{ id, resource (entity ID), event, text, severity, status, environment, service[], group, value, origin, type, createTime, lastReceiveTime, duplicateCount, attributes }`; `getAlert` and `applyAlertAction` add `history: [{ at, type: new \| status \| note, status, severity, text, user }]`, oldest first. Statuses: `open`, `ack` (acknowledged), `shelved`, `closed` (also `expired`, `blackout`, `unknown` from an alert manager). Actions: `ack` open → ack, `unack` ack → open, `shelve` open/ack → shelved, `unshelve` shelved → open, `close` open/ack/shelved → closed, `open` closed → open. There is no bulk operation; screens apply an action to each selected alert.

**Mock specifics.** Sixteen seeded alerts on the factory's machines in the environments *Production* and *Commissioning*. In development, while the Alerts area lists alerts, a new alert is raised about every 60 s divided by the playback speed; the controls' *Raise new alerts occasionally* setting switches this off.

## dataspace — implemented

| Operation | Input | Result | Errors |
|---|---|---|---|
| `getConnection()` | — | `{ state: connected \| expired \| disconnected \| not_configured, participantId, expiresAt, credentialConfigured, sharingTier }`: `credentialConfigured` tells whether the configuration provides the credential for `connect`; `sharingTier` is the configured data-sharing tier (`minimal`, `adjacent` or `timeseries`; `null` when not configured) | `unavailable` |
| `connect({ secret })` | credential; may be omitted when `credentialConfigured` | connection (as `getConnection`) | `unauthorized` (credential rejected), `unavailable` (gateway unreachable), `conflict` (not configured) |
| `disconnect()` | — | nothing | `conflict` (not configured), `unavailable` |
| `listPeers()` | — | `[{ id, name, capabilities[] }]` compatible participants | `unavailable` (also when not connected) |
| `getPeerCapabilities(peerId)` | peer ID | `{ peerId, name, atPeer: [{ capability, status }], here: [{ capability, status }] }`: what this factory may access at the peer, and what the peer may access here; `status` is `granted`, `denied` or `default` | `not_found`, `unavailable` (not connected) |
| `listCapabilityRequests()` | — | `[{ id, requesterId, capability, purpose, requestedAt, status: pending \| approved \| denied, note, decidedAt }]` incoming requests, pending first, then newest first | `unavailable` (also when not connected) |
| `decideCapabilityRequest(id, { approved, note })` | decision and optional note | updated request; approving grants the capability to the requester (`here` shows `granted`) | `conflict` (already decided; the message names the decision), `not_found` |
| `setCapabilityPolicy({ peerId, capability, action })` | `action`: `grant`, `deny` or `reset` (back to default) for what the peer may access here | nothing | `invalid` (unknown action or capability), `not_found` (unknown peer), `unavailable` (not connected) |
| `resolveNames(ids)` | registry IDs of participants | `{ [id]: name }`; unknown IDs are omitted | `unavailable` |
| `resolveBuilders(machineIds)` | machine entity IDs | `{ [machineId]: builderName }`; machines without a known builder are omitted | `unavailable` |

**Capabilities and tiers.** `twin:direct` (the machine entity), `twin:adjacents` (linked components) and `twin:history` (signal history). The data-sharing tier is deployment configuration: `minimal` shares `twin:direct`, `adjacent` adds `twin:adjacents`, `timeseries` adds `twin:history`.

**Connection changes.** After a successful `connect` or `disconnect` the data facade raises `CONNECTION_CHANGED` (`onDataEvent` in `src/data`); views showing the connection pass it to `useData` as `refreshOn` and reload at once. A backend adapter gets this for free.

**Mock specifics.** Connected by default with participant `participant-plant-north`, a session of 8 hours (expired once past) and the tier `minimal`. The credential is `plant-north-secret` unless the controls' *Configuration provides the dataspace credential* is set; *Dataspace gateway reachable* off makes `connect` fail as `unavailable`. A connection state preset in the controls applies until the operator connects or disconnects. Four peers (the machine builders of the factory's machines), seeded policies, and five capability requests (three pending, one from a service company that is not a peer).

## knowledgeBase — optional, off by default

This area exists only in a build with `VITE_KNOWLEDGE_BASE=on`, on the mock and backend sources alike. With the default setting, the data layer has no `knowledgeBase` area, the System screen has no knowledge base, health has no knowledge base check and simulated runs have no document retrieval step. The rest of this section applies when it is on.

Documents belong to an ingestion pipeline: `base` (page text, faster) or `structured` (section-aware, better for tables and diagrams). A document name is unique within its pipeline.

| Operation | Input | Result | Errors |
|---|---|---|---|
| `listDocuments({ pipeline })` | pipeline (default `base`) | `[{ name, pipeline, status: queued \| processing \| done \| failed, uploadedAt, size, chunks, description, error, jobId, progress }]` newest first; `progress` (0–1) while ingesting, `error` when failed | `invalid` (unknown pipeline), `unavailable` |
| `uploadDocument({ file, pipeline })` | `file`: `{ name, type, size, dataUrl }` read in the browser; PDF, Word (`.docx`) or Markdown by extension and MIME type, at most 50 MB | `{ jobId }`; the document is listed at once with status `queued` | `invalid` (type or size, with the reason), `conflict` (name exists in the pipeline) |
| `getIngestJob(jobId)` | job ID | `{ jobId, name, pipeline, status, progress, error, chunks }`; screens poll it every second until `done` or `failed` | `not_found` |
| `updateDescription(name, description, { pipeline })` | document, text, its pipeline (default `base`) | nothing | `not_found` |
| `deleteDocument(name, { pipeline })` | document and its pipeline (default `base`); also removes a failed or running ingestion | nothing | `not_found` |
| `query({ text, pipeline })` | test question | up to five passages `[{ document, location, text, score }]`, most relevant first; `location` is a page or section, `score` 0–1; empty when nothing matches | `invalid` (empty question), `unavailable` |

**Mock specifics.** Seeded manuals, procedures and specification sheets for the factory's machines in both pipelines, including one failed ingestion. Ingestion advances in five steps of 0.8 s (divided by the playback speed); a file whose name contains `corrupt` fails at 60 %. Markdown files are split into passages at their headings (location `section <heading>`); other files yield one passage from their name, since the mock does not parse PDF or Word. Retrieval ranks passages by the share of question terms they contain (deterministic).

## system — implemented

| Operation | Input | Result | Errors |
|---|---|---|---|
| `getHealth({ fresh })` | `fresh`: check anew instead of returning a cached result | `{ overall, checkedAt, checks: [{ id, label, status, latencyMs, detail }], models: [{ name, role, provider, available }] }`; `models` lists the models in use (`role` is `agent`); statuses `ok`, `degraded`, `error`, `unknown`; overall is `degraded` when some and `error` when all checks fail | `unavailable` |
| `getServiceSettings()` | — | `[{ key, label, value, deploymentValue, changed }]` for the context broker, time-series store, message broker and alert manager: the address in use, the deployment's address, and whether an operator override is in use | `unavailable` |
| `saveServiceSettings(changes)` | `{ [key]: address \| null }`; `null` (or the deployment value) resets to the deployment value. Addresses are URLs with scheme `http`, `https`, `ws`, `wss` or `mqtt` | settings (as `getServiceSettings`) | `invalid` (with the reason; nothing is saved) |

**Mock specifics.** Seven dependency checks with fixed latencies, and an eighth for the knowledge base when it is on. Checks of services with a setting report the address in use in `detail`; a host under the reserved `.invalid` domain does not answer, to show a failing dependency. Failures injected for `entities`, `alerts`, `knowledgeBase` or `dataspace`, or an unreachable gateway in the controls, fail the matching check. Overrides are kept in the mock store.
