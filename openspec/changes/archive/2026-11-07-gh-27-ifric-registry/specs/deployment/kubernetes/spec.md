# Spec Delta

## ADDED Requirements

### Requirement: Registry address in the chart
The chart SHALL pass `IFRIC_URL` when it is set.

#### Scenario: Rendered
- **WHEN** the chart is rendered with a registry address
- **THEN** it is in the configuration, including its port
