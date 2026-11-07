# Spec Delta

## ADDED Requirements

### Requirement: Where a run came from
Lists and the run view SHALL show a triggered run's source, and treat it like any other run.

#### Scenario: A triggered run
- **WHEN** a run's `source` is `ngsi` or `alert`
- **THEN** the open runs, the dashboard's tile, the run view and the incident history say `Machine event` or `Alert`

#### Scenario: An operator's run
- **WHEN** a run's `source` is `operator`
- **THEN** the run view says `Operator`, and lists show nothing extra
