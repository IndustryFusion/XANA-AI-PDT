# Spec Delta

## MODIFIED Requirements

### Requirement: Backend data source coverage
The backend data source SHALL serve these operations from the backend:
- listing, starting, reading and streaming runs;
- clarifying, confirming or rejecting a resolution, stopping and archiving;
- the escalation preflight and reopening a run;
- listing, reading and reopening incidents;
- the health report;
- the session: its configuration, sign-in, state and sign-out.

Its results SHALL have the shapes the interface documents.

#### Scenario: Start an incident from the UI
- **WHEN** an operator starts a new incident for a sample machine on the backend data source
- **THEN** the run view shows the observe, hypothesize, validate and decide steps as the backend completes them, followed by the waiting state

#### Scenario: Confirm and find in history
- **WHEN** the operator confirms the resolution and archives the run
- **THEN** the run shows as completed, and then appears in incident history with its full trace

#### Scenario: Escalation not offered yet
- **WHEN** the operator opens the escalation dialog of a run on the backend data source
- **THEN** the dialog says that escalation is not possible and gives the backend's reason

#### Scenario: Shapes checked
- **WHEN** the data-interface tests run against the backend data source with a recorded backend
- **THEN** every operation it serves returns the documented shape
