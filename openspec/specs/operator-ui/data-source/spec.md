# operator-ui/data-source Specification

## Purpose
Defines how the operator UI obtains its data so that it runs fully on built-in mock data today and can be attached to a backend later by configuration, without changing any screen.

## Requirements

### Requirement: Configurable data source
The UI SHALL obtain all data from exactly one data source selected by configuration, with the mock data source as the default.

#### Scenario: Default configuration
- **WHEN** the UI is started without data-source configuration
- **THEN** it runs on the mock data source and every area is usable

#### Scenario: Unavailable data source
- **WHEN** the configuration names a data source that is not available in the build
- **THEN** the UI shows a configuration error that names the setting and the accepted values, instead of a broken screen

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
The UI data interface SHALL be documented per area (session, runs, incidents, entities, alerts, dataspace, knowledge base, system health), listing each operation, its inputs, the data it returns and its error cases.

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
