# Spec Delta

## ADDED Requirements

### Requirement: No mock data on a backend build
The backend source SHALL serve every operation of the interface itself, and SHALL NOT use the mock source.

#### Scenario: Every operation
- **WHEN** the interface's operations are compared with what the backend source serves, without the optional knowledge base
- **THEN** all are served

#### Scenario: No way to the mock
- **WHEN** a test reads the backend source's files
- **THEN** none imports the mock source, and its operations differ from the mock's

#### Scenario: The optional knowledge base
- **WHEN** a backend build has the knowledge base turned on
- **THEN** its operations reject as `unavailable`, and show no sample documents

#### Scenario: Development controls
- **WHEN** a backend build runs in development
- **THEN** there are no mock data controls
