# Spec Delta

## ADDED Requirements

### Requirement: An incident's source
An incident SHALL keep its run's `source`, in the history and in its record.

#### Scenario: Archived
- **WHEN** a triggered run is archived
- **THEN** its incident has an incident number and that `source`

#### Scenario: An existing incident
- **WHEN** an incident stored before this change is read
- **THEN** its `source` is `operator`
