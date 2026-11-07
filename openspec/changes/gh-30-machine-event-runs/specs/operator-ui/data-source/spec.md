# Spec Delta

## ADDED Requirements

### Requirement: Source in the interface
`RunSummary` and `IncidentSummary` SHALL have `source`, on the mock and backend sources alike.

#### Scenario: Shapes
- **WHEN** the shape tests run on recorded backend answers and on the mock
- **THEN** `source` is one of `operator`, `ngsi` and `alert`
