# Spec Delta

## MODIFIED Requirements

### Requirement: Observe the machine
The observe step SHALL read the machine and its directly related entities from the context broker, and their recent attribute history, relationship and text changes and entity lifecycle from the time-series store. History SHALL include rows where the deleted flag is null. It SHALL report what it read, per source, with that source's status.

#### Scenario: Machine with components
- **WHEN** the observed machine has relationships to two components
- **THEN** the step's content includes the machine's and both components' current values. It lists the signals considered with name, value, unit and recent trend, and reports both sources as `ok`.

#### Scenario: Unknown machine
- **WHEN** the context broker has no entity with the given machine identifier
- **THEN** the step reports the machine as not found and the round continues with the issue text and any history found

#### Scenario: Relationship and text changes
- **WHEN** a relationship target or a text attribute changed within the window
- **THEN** the step's content lists those changes, newest first, with their time

#### Scenario: Entity lifecycle
- **WHEN** a related entity was created or deleted within the window
- **THEN** the step's content lists that with its time

#### Scenario: Null deleted flag
- **WHEN** history rows have a null deleted flag
- **THEN** they count as not deleted

#### Scenario: Attributes named by full IRIs
- **WHEN** an entity's attributes are full IRIs and history holds the same IRIs
- **THEN** each signal appears once, with its current value and trend

#### Scenario: Changes cannot be read
- **WHEN** reading changes or lifecycle fails, or the entities table does not exist
- **THEN** the round continues with the rest, and the step says so
