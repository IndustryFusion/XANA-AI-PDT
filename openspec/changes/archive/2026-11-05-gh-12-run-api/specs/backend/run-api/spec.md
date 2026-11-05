## ADDED Requirements

### Requirement: Start a run
A client SHALL be able to start a run for a machine and an issue. The backend SHALL answer at once with the new run's identifier, and SHALL run the first analysis round in the background.

#### Scenario: Started
- **WHEN** a client starts a run with a machine identifier and the issue "Spindle vibration above normal"
- **THEN** the answer arrives before the first step completes and contains the run identifier, and the run is listed as active with status `running`

#### Scenario: Short machine name
- **WHEN** a client starts a run with a machine's short name and the context broker knows exactly one machine with that name
- **THEN** the run uses that machine's full identifier

#### Scenario: Invalid input
- **WHEN** a client starts a run with an empty machine identifier, an empty issue or an issue longer than 2000 characters
- **THEN** the request is refused as `invalid` with the reason, and no run is created

### Requirement: Active runs and run status
The backend SHALL list all runs that are not archived, newest first, with identifier, incident number, machine, issue, status, start time and last update. It SHALL return a single run with its state data, completed steps and reopen information.

#### Scenario: List
- **WHEN** a client lists active runs while two runs are open and one is completed but not archived
- **THEN** all three are listed, newest first

#### Scenario: Unknown run
- **WHEN** a client requests a run identifier that does not exist or was archived
- **THEN** the request is refused as `not_found`

### Requirement: Operations allowed per state
The backend SHALL accept each run operation only in the states listed here, and refuse it as `conflict` otherwise:
- clarify in `awaiting_input`;
- confirm or reject in `awaiting_confirmation`;
- stop in `running`, `awaiting_input` and `awaiting_confirmation`;
- archive in `completed`, `failed` and `stopped`.

#### Scenario: Clarify while running
- **WHEN** a client sends a clarification for a run in `running`
- **THEN** the request is refused as `conflict` and the run is unchanged

#### Scenario: Archive an open run
- **WHEN** a client archives a run in `awaiting_input`
- **THEN** the request is refused as `conflict`

### Requirement: Clarify
A clarification SHALL record the operator's text and the names, types and sizes of any attached files as a clarification step, and SHALL start a new analysis round that uses the text.

#### Scenario: Clarification accepted
- **WHEN** a client clarifies a run in `awaiting_input` with text and one attached image
- **THEN** a clarification step with the text and the file's name, type and size is added, the run returns to `running` and a new round starts

#### Scenario: Too many or too large files
- **WHEN** a clarification has more than five files or a file larger than 10 MB
- **THEN** the request is refused as `invalid` and nothing is recorded

### Requirement: Confirm or reject the resolution
Confirming SHALL record a resolution step and complete the run through the act step. Rejecting SHALL require a reason, SHALL record a resolution step with the reason, and SHALL start a new round in which the rejected root cause is not proposed again.

#### Scenario: Confirm
- **WHEN** a client confirms the resolution of a run in `awaiting_confirmation`
- **THEN** a resolution step and an act step are added, and the run becomes `completed` with root cause, recommended action, confidence and `incidentLogged`

#### Scenario: Reject
- **WHEN** a client rejects with the reason "Bearing was replaced last week"
- **THEN** a resolution step with the reason is added, the run returns to `running`, and the next `awaiting_confirmation` state lists the rejected resolution with its reason

#### Scenario: Reject without reason
- **WHEN** a client rejects without a reason
- **THEN** the request is refused as `invalid`

### Requirement: Stop and archive
Stopping SHALL end an open run as `stopped`, cancelling a round in progress. Archiving SHALL remove a finished run from the active list and create its incident record.

#### Scenario: Stop during a round
- **WHEN** a client stops a run while a round is in progress
- **THEN** the round is cancelled, no further step is added, and the run becomes `stopped` with the operator as the one who stopped it and `reopenable` false

#### Scenario: Archive
- **WHEN** a client archives a `completed` run
- **THEN** the run is no longer listed as active, and the incident history contains it

### Requirement: Phase 1 limits are explicit
Operations that belong to later phases SHALL answer in a defined way, not fail unexpectedly.

#### Scenario: Escalation preflight
- **WHEN** a client asks whether a run can be escalated
- **THEN** the answer says escalation is not possible, with the reason that escalation is not available in this version

#### Scenario: Reopen a run
- **WHEN** a client asks to reopen a stopped run
- **THEN** the request is refused as `conflict`, because only runs with a machine-builder conversation can be reopened

### Requirement: Runs survive a restart
The backend SHALL store every non-archived run with its steps and state, and SHALL restore them at startup. A round that was in progress when the backend stopped SHALL run again from its start, without duplicate steps.

#### Scenario: Paused run after restart
- **WHEN** the backend restarts while a run waits for input
- **THEN** the run is listed again with the same status, steps, question and incident number, and can be clarified

#### Scenario: Round interrupted by restart
- **WHEN** the backend stops while a run's second round is between validate and decide
- **THEN** after the restart, the second round's earlier steps are removed and the second round runs again from observe

#### Scenario: Memory unavailable
- **WHEN** the memory database is unreachable and a client starts a run
- **THEN** the request is refused as `unavailable` with a reason, rather than starting a run that cannot be stored

### Requirement: Bounded concurrency
The backend SHALL run at most the configured number of rounds at the same time. Further rounds SHALL wait in status `running` until a slot is free.

#### Scenario: Limit reached
- **WHEN** the limit is 2 and three runs are started at once
- **THEN** two rounds run at once, and the third starts its first step only after one of them has paused or ended

### Requirement: Stable error kinds
Every refused request SHALL carry an error kind (`not_found`, `conflict`, `invalid`, `unavailable`) and a readable message, with a matching HTTP status.

#### Scenario: Error shape
- **WHEN** any request is refused
- **THEN** the response holds the kind and the message, and the HTTP status is 404, 409, 422 or 503 respectively
