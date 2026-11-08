# backend/run-api Specification

## Purpose
Defines the HTTP interface through which operators start diagnostic runs, follow them, answer questions, confirm or reject the proposed resolution, and stop or archive them, with runs that survive a restart and stable error kinds.

## Requirements

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
Every refused request SHALL carry an error kind (`not_found`, `conflict`, `invalid`, `unavailable`, `unauthorized`) and a readable message, with a matching HTTP status. `unavailable` answers 503 for the backend's own state, and 502 for a service behind the backend that cannot be used.

#### Scenario: Error shape
- **WHEN** any request is refused
- **THEN** the response holds the kind and the message, and the HTTP status is 404, 409, 422, 503 or 401 respectively, or 502 for a service behind the backend

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

### Requirement: Escalation statuses
A run SHALL be able to be `awaiting_machine_builder`, `awaiting_operator_approval`, `awaiting_recommendation_review` and `mb_closed`, with the operations each allows.

#### Scenario: Waiting for the builder
- **WHEN** a run is `awaiting_machine_builder`
- **THEN** stopping is possible, and clarifying, confirming, archiving and escalating are refused as `conflict`

#### Scenario: Restart while waiting
- **WHEN** the backend restarts while a run is `awaiting_machine_builder`
- **THEN** the run has the same status, reference, recipient, data sent and delivery state, nothing is sent again, and no round starts

#### Scenario: Run shape
- **WHEN** an escalated run is read or streamed
- **THEN** it has `escalation_ref`, `escalation` with `ref`, `recipient`, `tier`, `data` and `sent_at`, and `outbox`, and data `escalation_ref` and `builder`

#### Scenario: Unknown run
- **WHEN** a route is called for an unknown run
- **THEN** it is refused as `not_found`

### Requirement: Stop and reopen with a conversation
Stopping and reopening SHALL act on the conversation.

#### Scenario: Stop
- **WHEN** a run with an open conversation is stopped
- **THEN** `close(withdrawn)` is sent, and the run is reopenable

#### Scenario: Stop while only the machine builder can close
- **WHEN** a close is refused and the conversation isn't closed
- **THEN** the run stops, says so, and the close stays pending until it can go. Only a closed conversation counts as done

#### Scenario: Archive with a close pending
- **WHEN** a run with a close pending is archived, or the machine builder's side didn't receive the close
- **THEN** archiving is refused as `conflict`, and the close is repeated

#### Scenario: A close that keeps failing
- **WHEN** a close keeps failing to reach the machine builder
- **THEN** it is tried again after 60 seconds, then twice as long each time, up to an hour, and the conversation shows one close

#### Scenario: Stop after a half-finished escalation
- **WHEN** a run whose files went out and whose request failed is stopped
- **THEN** `close(withdrawn)` is sent, and it can't be reopened

#### Scenario: Stop with the gateway failing
- **WHEN** the close can't be sent
- **THEN** the run stops, says so, and the close is sent when it can be

#### Scenario: Reopen a run
- **WHEN** a stopped or `mb_closed` run with a conversation is reopened
- **THEN** `reopen` is sent, and it waits for the machine builder

#### Scenario: Not reopenable
- **WHEN** the conversation was closed as `escalated` or `superseded`, or the run has none
- **THEN** reopening is refused as `conflict`, and nothing is sent

#### Scenario: A builder's reopen of a completed run
- **WHEN** the machine builder reopens the conversation of a completed run
- **THEN** the run waits for the machine builder

#### Scenario: Reopen an incident with something waiting
- **WHEN** an incident is reopened with a request or recommendation unanswered
- **THEN** the new run waits for that, and what was sent earlier isn't shown as new

#### Scenario: Reopen an incident
- **WHEN** an archived incident with a conversation is reopened
- **THEN** a new run continues its conversation, with its messages, waiting for the machine builder

### Requirement: A run's source
Every run SHALL say where it came from, as `source`: `operator`, `ngsi` or `alert`, in the list, the run and the stream, and behave alike in every other way.

#### Scenario: Started by an operator
- **WHEN** a run is started through `POST /api/agent/run`, or by reopening an incident
- **THEN** its `source` is `operator`

#### Scenario: Triggered
- **WHEN** a run starts from an event
- **THEN** its `source` names the kind of event, and it has a machine ID, a snapshot and the same operations as any other

#### Scenario: An existing run
- **WHEN** a run stored before this change is read
- **THEN** its `source` is `operator`

### Requirement: Automatic archiving
A finished run (`completed`, `failed`, `stopped` or `mb_closed`) whose last change is `AUTO_ARCHIVE_AFTER_S` seconds old or older SHALL be archived as an operator archive would, unless its close has not yet reached the machine builder.

#### Scenario: Finished run after the delay
- **WHEN** a `completed`, `failed`, `stopped` or `mb_closed` run has not changed for `AUTO_ARCHIVE_AFTER_S` seconds
- **THEN** it is no longer listed as active, and the incident history holds it with its full record, as after an operator archive

#### Scenario: Before the delay
- **WHEN** a finished run changed less than `AUTO_ARCHIVE_AFTER_S` seconds ago
- **THEN** it stays listed

#### Scenario: Waiting runs
- **WHEN** a run is `running`, waits for the operator, or waits for the machine builder, however long ago it changed
- **THEN** it is not archived automatically

#### Scenario: Pending close
- **WHEN** a stopped run's close has not yet reached the machine builder
- **THEN** it is not archived automatically, and once the close has gone out the delay counts from that change

#### Scenario: Turned off
- **WHEN** `AUTO_ARCHIVE_AFTER_S` is `0`
- **THEN** no run is archived automatically

#### Scenario: After a restart
- **WHEN** the backend restarts while a finished run is part way through its delay
- **THEN** it is archived when the delay since its last change has passed, not later and not at once

#### Scenario: Changed or archived meanwhile
- **WHEN** an operator reopens or archives a run at the moment it becomes due
- **THEN** a reopened run stays active, and a run is archived once, with one incident record

#### Scenario: Memory database unavailable
- **WHEN** the incident can't be written
- **THEN** the run stays listed, and it is archived on a later attempt

### Requirement: Machine builder in the run list
The list of active runs SHALL give each escalated run's machine builder, with ID and name.

#### Scenario: Escalated run
- **WHEN** a run has been escalated
- **THEN** its entry in the list has the machine builder's ID and name

#### Scenario: Not escalated
- **WHEN** a run has not been escalated
- **THEN** its entry has no machine builder
