# Spec Delta

## ADDED Requirements

### Requirement: Model readiness
Before starting a new analysis round for an operator's request, the backend SHALL check that the language model is available, and SHALL refuse the request as `unavailable` with a reason if it is not, within the health check timeout.

#### Scenario: Model unavailable at start
- **WHEN** a client starts a run while the model server cannot be reached
- **THEN** the request is refused as `unavailable` within the health check timeout, with a reason naming the language model, and no run is created

#### Scenario: Model unavailable at clarify
- **WHEN** a client clarifies or rejects a resolution while the model is unavailable
- **THEN** the request is refused as `unavailable`, and the run keeps its state

#### Scenario: Model not needed
- **WHEN** a client confirms a resolution while the model is unavailable
- **THEN** the confirmation proceeds, because it does not call the model
