# Spec Delta

## ADDED Requirements

### Requirement: Optional ontology service
The local environment SHALL offer Fuseki on request, loaded with sample shapes and knowledge for the sample machines. Without the request, it SHALL start without one.

#### Scenario: With the service
- **WHEN** a contributor starts the local environment with its documented ontology profile
- **THEN** the value editor shows hints for the sample machines

#### Scenario: Without it
- **WHEN** a contributor starts the local environment as usual
- **THEN** no Fuseki starts, and the value editor works without hints
