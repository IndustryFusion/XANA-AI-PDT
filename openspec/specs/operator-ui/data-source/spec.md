# operator-ui/data-source Specification

## Purpose
Defines how the operator UI obtains its data so that it runs fully on built-in mock data today and can be attached to a backend later by configuration, without changing any screen.

## Requirements

### Requirement: Configurable data source
The UI SHALL obtain all data through one data source selected by configuration, with the mock data source as the default. The backend data source SHALL serve the operations the backend provides, and SHALL delegate every other operation of the interface to the mock data source.

#### Scenario: Default configuration
- **WHEN** the UI is started without data-source configuration
- **THEN** it runs on the mock data source and every area is usable

#### Scenario: Unavailable data source
- **WHEN** the configuration names a data source that is not available in the build
- **THEN** the UI shows a configuration error that names the setting and the accepted values, instead of a broken screen

#### Scenario: Backend data source selected
- **WHEN** the UI is started with the backend data source
- **THEN** active incidents, run views, incident history and system health show the backend's data, and every other area works on the mock data

### Requirement: Runs without a backend
On the mock data source the UI SHALL work with no backend, broker or database running.

#### Scenario: Offline start
- **WHEN** the UI is started on the mock data source with no other service running
- **THEN** sign-in, navigation and the dashboard work, and the UI makes no network requests other than loading its own files

### Requirement: Single data boundary
Screens SHALL depend only on the UI data interface, never on a particular data source, so that replacing the data source changes no screen.

#### Scenario: Boundary check
- **WHEN** the frontend checks run
- **THEN** they fail if any screen refers to the mock data source directly or performs network requests outside the data source

### Requirement: Documented data interface
The UI data interface SHALL be documented per area (session, runs, incidents, entities, alerts, dataspace, system health, and the optional knowledge base), listing each operation, its inputs, the data it returns and its error cases.

#### Scenario: Interface coverage
- **WHEN** the data-interface tests run against the mock data source
- **THEN** every documented operation of the areas implemented so far is exercised, and each returns data matching its documented shape

### Requirement: Realistic mock data
The mock data source SHALL provide consistent, realistic seeded data, so that identifiers referenced in one area resolve in the others.

#### Scenario: Consistent references
- **WHEN** a mock incident or alert references a machine
- **THEN** that machine exists as an entity in the mock data

#### Scenario: Stable between reloads
- **WHEN** the UI is reloaded on the mock data source
- **THEN** the seeded data is the same as before the reload, apart from changes the operator made in the current session

### Requirement: Failure and latency injection
In development mode, the mock data source SHALL let the operator set, per area, an added delay and a failure mode.

#### Scenario: Slow area
- **WHEN** a delay is set for an area
- **THEN** that area's views show their loading state for at least that delay

#### Scenario: Failing area
- **WHEN** an area is set to fail
- **THEN** that area's views show their error state and the other areas keep working

#### Scenario: Not in production builds
- **WHEN** the UI is built for production
- **THEN** the failure and latency controls are not available

### Requirement: Error isolation
A failure of one area of the data source SHALL NOT prevent other areas or the application shell from working.

#### Scenario: Session works while another area fails
- **WHEN** any single area other than session fails
- **THEN** navigation, sign-out and all other areas keep working

### Requirement: Backend data source coverage
The backend data source SHALL serve these operations from the backend:
- listing, starting, reading and streaming runs;
- clarifying, confirming or rejecting a resolution, stopping and archiving;
- the escalation preflight and reopening a run;
- listing, reading and reopening incidents;
- the health report;
- the session: its configuration, sign-in, state and sign-out.

Its results SHALL have the shapes the interface documents.

#### Scenario: Start an incident from the UI
- **WHEN** an operator starts a new incident for a sample machine on the backend data source
- **THEN** the run view shows the observe, hypothesize, validate and decide steps as the backend completes them, followed by the waiting state

#### Scenario: Confirm and find in history
- **WHEN** the operator confirms the resolution and archives the run
- **THEN** the run shows as completed, and then appears in incident history with its full trace

#### Scenario: Escalation not offered yet
- **WHEN** the operator opens the escalation dialog of a run on the backend data source
- **THEN** the dialog says that escalation is not possible and gives the backend's reason

#### Scenario: Shapes checked
- **WHEN** the data-interface tests run against the backend data source with a recorded backend
- **THEN** every operation it serves returns the documented shape

### Requirement: Entities area from the backend
The backend data source SHALL serve the entities area from the backend: query, edit, import, history and time-shift. Attribute names SHALL reach screens unchanged.

#### Scenario: Explorer on real data
- **WHEN** an operator uses the Data explorer on the backend data source
- **THEN** it shows and changes what the context broker holds

#### Scenario: Attribute names unchanged
- **WHEN** an attribute's name holds an underscore or is an IRI
- **THEN** the screen receives the name exactly as the broker gave it

### Requirement: Backend errors in interface terms
The backend data source SHALL report backend refusals with the backend's error kind and message, and SHALL report a backend that cannot be reached as `unavailable`, affecting only the areas it serves.

#### Scenario: Conflict
- **WHEN** the backend refuses an operation as a conflict
- **THEN** the operation rejects with kind `conflict` and the backend's message

#### Scenario: Backend stopped
- **WHEN** the backend is not running and the operator opens active incidents
- **THEN** active incidents shows its error state with retry, and the data explorer, which uses the mock data, still works

### Requirement: Run stream recovery
When the backend data source loses a run's live connection, it SHALL report that it is reconnecting, reconnect with increasing delays, and resume with the run's complete current state.

#### Scenario: Connection lost
- **WHEN** the live connection of a watched run drops and the backend is reachable again a few seconds later
- **THEN** the run view shows that it is reconnecting, then shows the run's current state including steps completed meanwhile, without a page reload

#### Scenario: Run gone
- **WHEN** the watched run has been archived by another operator
- **THEN** the stream reports `not_found` and the run view shows that the run is no longer active

### Requirement: Knowledge base area is optional
The data layer SHALL expose the knowledge base area only while the knowledge base is turned on, on every data source.

#### Scenario: Area absent by default
- **WHEN** the UI is built with default settings
- **THEN** the data layer has no knowledge base area on either data source

#### Scenario: Backend build shows no mock documents
- **WHEN** the UI is built with the backend data source and default settings
- **THEN** no screen shows documents from the mock data source

### Requirement: Live updates from the backend
The backend data source SHALL serve `subscribeEntities` and `getLiveUpdateHealth` from the backend.

#### Scenario: Events
- **WHEN** the backend streams a change
- **THEN** the subscriber receives an `update` event with the entity's ID and its attributes, with names unchanged

#### Scenario: Lost stream
- **WHEN** the stream closes or cannot open
- **THEN** the subscriber receives one `error` event of kind `unavailable`, and no further events

#### Scenario: Unsubscribing
- **WHEN** the screen unsubscribes
- **THEN** the stream is closed, and no more events arrive

### Requirement: Value hints from the backend
The backend data source SHALL serve `getValueHints` from the backend, with its result in the documented shape.

#### Scenario: Hints
- **WHEN** a screen asks for hints of an attribute
- **THEN** it receives the kind of hint, the allowed values and the limits

### Requirement: Alerts from the backend
The backend data source SHALL serve the `alerts` area from the backend, with results in the documented shapes.

#### Scenario: Alerts on real data
- **WHEN** an operator uses the Alerts screen on the backend data source
- **THEN** it shows and changes what Alerta holds, including the severity bar, filters, bulk actions, detail and automatic refresh

#### Scenario: Partial failure of a bulk action
- **WHEN** an action fails for some selected alerts
- **THEN** those stay selected with the reason from the backend

### Requirement: Dataspace from the backend
The backend data source SHALL serve the connection, peers, capabilities, capability requests and policies of the `dataspace` area from the backend, in the documented shapes.

#### Scenario: Dataspace on real data
- **WHEN** an operator uses the Dataspace screen on the backend data source
- **THEN** connecting, disconnecting, peers, capabilities, requests and policies act on the real gateway

#### Scenario: Renewal failing
- **WHEN** token renewal has failed repeatedly
- **THEN** the connection section says so

#### Scenario: Policy actions
- **WHEN** an operator grants, denies or resets a capability for a peer
- **THEN** the source sends the gateway's approve, deny or reset

### Requirement: Names and the factory from the backend
The backend data source SHALL serve `dataspace.resolveNames`, `dataspace.resolveBuilders` and `session.getFactory` from the backend, leaving out what the registry didn't return.

#### Scenario: Identifiers stay as they are
- **WHEN** names are returned by an identifier holding `_`
- **THEN** the identifier is not changed

#### Scenario: Screens with an empty name
- **WHEN** a name lookup failed
- **THEN** the screen shows the identifier

#### Scenario: Factory without an owner
- **WHEN** the factory has no owner or location
- **THEN** the user pane and Dataspace screen leave them out

### Requirement: Escalation from the backend
The backend data source SHALL serve `escalationPreflight`, `escalate` and `getOutboxStatus` from the backend, in the documented shapes.

#### Scenario: Escalate on real data
- **WHEN** an operator escalates a run on the backend data source
- **THEN** the dialog shows the real recipient and data, and after confirming the waiting panel shows the reference and delivery state

#### Scenario: Slow send
- **WHEN** a send takes longer than other requests may
- **THEN** the source goes on waiting for it

#### Scenario: A failed send
- **WHEN** escalating fails
- **THEN** the dialog says why, and the run's panel goes on working

### Requirement: The conversation from the backend
The backend data source SHALL serve `sendConversationAct`, `askAgent`, `refreshConversationStatus`, `recordMachineBuilderClose`, `approveDataRequest` and `replyToRecommendation` from the backend, and nothing of runs from the mock.

#### Scenario: Slow answers
- **WHEN** the agent or a send takes longer than other requests may
- **THEN** the source goes on waiting for it

#### Scenario: A free-text request
- **WHEN** a message is a free-text request
- **THEN** grant and deny aren't offered for it

### Requirement: Source in the interface
`RunSummary` and `IncidentSummary` SHALL have `source`, on the mock and backend sources alike.

#### Scenario: Shapes
- **WHEN** the shape tests run on recorded backend answers and on the mock
- **THEN** `source` is one of `operator`, `ngsi` and `alert`

### Requirement: No mock data on a backend build
The backend source SHALL serve every operation of the interface itself, and SHALL NOT use the mock source.

#### Scenario: Every operation
- **WHEN** the interface's operations are compared with what the backend source serves, without the optional knowledge base
- **THEN** all are served

#### Scenario: No way to the mock
- **WHEN** a test reads the backend source's files
- **THEN** none imports the mock source, and its operations differ from the mock's

#### Scenario: The optional knowledge base
- **WHEN** a backend build has the knowledge base turned on
- **THEN** its operations reject as `unavailable`, and show no sample documents

#### Scenario: Development controls
- **WHEN** a backend build runs in development
- **THEN** there are no mock data controls
