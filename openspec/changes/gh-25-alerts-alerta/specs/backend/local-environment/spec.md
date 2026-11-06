# Spec Delta

## ADDED Requirements

### Requirement: Optional alert manager
The local environment SHALL offer Alerta on request, with the platform's severities and sample alerts on the sample machines in the form the platform's rules produce. Without the request, it SHALL start without one.

#### Scenario: With the service
- **WHEN** a contributor starts the local environment with its documented alerts profile
- **THEN** the Alerts screen lists the sample alerts, and a run on such a machine shows its alert

#### Scenario: Without it
- **WHEN** a contributor starts the local environment as usual
- **THEN** no Alerta starts, the Alerts screen says it is unavailable, and runs still work
