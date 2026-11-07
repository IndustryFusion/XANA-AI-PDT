# Spec Delta

## ADDED Requirements

### Requirement: Alerts in the observe step
The run view SHALL show the alerts an observe step found, with severity, resource and text, and link each to its alert.

#### Scenario: Alert shown
- **WHEN** an observe step holds an alert
- **THEN** the step shows it, and it opens the alert's detail

#### Scenario: Source unavailable
- **WHEN** the alert source was unavailable
- **THEN** the step's sources say so
