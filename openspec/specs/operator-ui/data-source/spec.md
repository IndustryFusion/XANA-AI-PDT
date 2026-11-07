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
