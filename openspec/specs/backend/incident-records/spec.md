# backend/incident-records Specification

## Purpose
Defines the incidents the backend records from finished runs: their numbers, the memory of confirmed diagnoses used by later runs, the history records operators browse and filter, and reopening an incident as a new run.

## Requirements

### Requirement: Incident numbers
Each run SHALL receive a unique, increasing incident number when it first leaves `running`. The number SHALL stay with the run and its history record.

#### Scenario: First pause
- **WHEN** a run's first round ends waiting for input
- **THEN** the run has an incident number one higher than the highest number given so far

#### Scenario: Kept across rounds
- **WHEN** the same run pauses again in a later round
- **THEN** its incident number is unchanged

### Requirement: Memory of confirmed diagnoses
When an operator confirms a resolution, the backend SHALL store the machine, the issue, the confirmed root cause, the recommended action and the trace. The diagnostic workflow SHALL find this record as a past incident for later runs of the same machine.

#### Scenario: Found by a later run
- **WHEN** a run for machine M is confirmed and a new run for M reaches its decide step
- **THEN** the decide step lists the confirmed incident with its root cause among the past incidents

#### Scenario: Survives a restart
- **WHEN** the backend restarts after a confirmation
- **THEN** the confirmed incident is still found as a past incident

### Requirement: History records
Archiving a run SHALL create a history record with the incident number, machine, issue, outcome, root cause, decision, resolution, start and close time, and the full step trace.

#### Scenario: Completed run archived
- **WHEN** a completed run is archived
- **THEN** the incident detail shows outcome `completed`, the confirmed root cause, the decision with its confidence, and every step of every round with its input and output

#### Scenario: Stopped run archived
- **WHEN** a run stopped while waiting for input is archived
- **THEN** the record shows outcome `stopped`, the last decision step's content as the decision, and the stop reason as the resolution

### Requirement: List and filter incidents
The backend SHALL list history records newest first, filtered by machine, by one or more outcomes and by a closing date range (inclusive dates).

#### Scenario: Filter by machine and outcome
- **WHEN** a client lists incidents for machine M with outcome `completed`
- **THEN** only completed incidents of M are listed, newest first

#### Scenario: Date range
- **WHEN** a client lists incidents closed from 2026-11-01 to 2026-11-03
- **THEN** incidents closed at any time on those three days are listed, and no others

#### Scenario: Unknown incident
- **WHEN** a client requests an incident that does not exist
- **THEN** the request is refused as `not_found`

### Requirement: Reopen an incident
Reopening an incident SHALL start a new run with the incident's machine and issue, and SHALL record the new run on the incident. Reopening again SHALL be refused while that new run is not archived.

#### Scenario: Reopen
- **WHEN** a client reopens an archived incident
- **THEN** a new run starts with the same machine and issue, its identifier is returned, and the incident shows it as the reopened run

#### Scenario: Already reopened
- **WHEN** a client reopens an incident whose reopened run is still active
- **THEN** the request is refused as `conflict`

### Requirement: Escalation in the record
An archived incident SHALL record the builder, the conversation reference and the outcome.

#### Scenario: Archived after escalating
- **WHEN** an escalated run is stopped and archived
- **THEN** its record says it was escalated, with the reference, the builder's name, the escalation and the outcome, and a summary in the list says the same

#### Scenario: Not escalated
- **WHEN** a run that wasn't escalated is archived
- **THEN** these are empty, as before

### Requirement: Conversation in the record
An archived incident SHALL record the chat, the conversation's state, the builder and the outcome.

#### Scenario: Archived after a conversation
- **WHEN** a run with a conversation is archived
- **THEN** its record holds every message, the last state, the builder and outcome, including `mb_closed`

### Requirement: An incident's source
An incident SHALL keep its run's `source`, in the history and in its record.

#### Scenario: Archived
- **WHEN** a triggered run is archived
- **THEN** its incident has an incident number and that `source`

#### Scenario: An existing incident
- **WHEN** an incident stored before this change is read
- **THEN** its `source` is `operator`
