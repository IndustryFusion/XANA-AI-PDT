## MODIFIED Requirements

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

## ADDED Requirements

### Requirement: Backend data source coverage
The backend data source SHALL serve these operations from the backend:
- listing, starting, reading and streaming runs;
- clarifying, confirming or rejecting a resolution, stopping and archiving;
- the escalation preflight and reopening a run;
- listing, reading and reopening incidents;
- the health report.

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
