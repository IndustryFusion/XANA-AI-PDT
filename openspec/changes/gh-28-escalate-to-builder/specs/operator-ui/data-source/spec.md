# Spec Delta

## ADDED Requirements

### Requirement: Escalation from the backend
The backend data source SHALL serve `escalationPreflight`, `escalate` and `getOutboxStatus` from the backend, in the documented shapes.

#### Scenario: Escalate on real data
- **WHEN** an operator escalates a run on the backend data source
- **THEN** the dialog shows the real recipient and data, and after confirming the waiting panel shows the reference and delivery state

#### Scenario: Slow send
- **WHEN** a send takes longer than other requests may
- **THEN** the source goes on waiting for it

#### Scenario: A failed send
- **WHEN** escalating fails
- **THEN** the dialog says why, and the run's panel goes on working
