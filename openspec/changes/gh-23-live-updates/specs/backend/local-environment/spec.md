# Spec Delta

## ADDED Requirements

### Requirement: Optional MQTT broker
The local environment SHALL offer an MQTT broker on request, so that changes reach the explorer live. Without the request, it SHALL start without one.

#### Scenario: With the broker
- **WHEN** a contributor starts the local environment with its documented live updates profile, and changes an entity
- **THEN** the change reaches an open explorer

#### Scenario: Without it
- **WHEN** a contributor starts the local environment as usual
- **THEN** no MQTT broker starts, and the explorer says live updates are unavailable
