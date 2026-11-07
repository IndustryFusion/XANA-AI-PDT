# Spec Delta

## ADDED Requirements

### Requirement: Finished runs stay until archived
A finished run SHALL stay in the list of runs until an operator archives it. There is no automatic archive.

#### Scenario: Time passes
- **WHEN** a run has finished, however long ago, and also after a restart
- **THEN** it is listed, with its status, until an operator archives it
