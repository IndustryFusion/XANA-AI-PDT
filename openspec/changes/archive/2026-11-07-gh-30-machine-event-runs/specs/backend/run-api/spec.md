# Spec Delta

## ADDED Requirements

### Requirement: A run's source
Every run SHALL say where it came from, as `source`: `operator`, `ngsi` or `alert`, in the list, the run and the stream, and behave alike in every other way.

#### Scenario: Started by an operator
- **WHEN** a run is started through `POST /api/agent/run`, or by reopening an incident
- **THEN** its `source` is `operator`

#### Scenario: Triggered
- **WHEN** a run starts from an event
- **THEN** its `source` names the kind of event, and it has a machine ID, a snapshot and the same operations as any other

#### Scenario: An existing run
- **WHEN** a run stored before this change is read
- **THEN** its `source` is `operator`
