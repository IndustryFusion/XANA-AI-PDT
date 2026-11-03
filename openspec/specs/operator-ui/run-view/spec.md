# operator-ui/run-view Specification

## Purpose
Shows one diagnostic run as structured, live information (steps, hypotheses, decision) and gives the operator exactly the actions that the run's current state allows.

## Requirements

### Requirement: Run header
The run view SHALL show the incident number when assigned, the escalation reference once escalated, the machine as an entity reference, the issue, and the run status as a text label.

#### Scenario: Header of an escalated run
- **WHEN** an escalated run is shown
- **THEN** the header shows incident number, escalation reference, machine, issue and the status label

### Requirement: Live step feed
The run view SHALL show the run's agent steps in the order they complete, each with its kind, time and a summary of its structured output, and SHALL add new steps as they arrive.

#### Scenario: Steps stream in
- **WHEN** a run is running
- **THEN** each completed step appears at the end of the feed without a reload, and a progress indication shows that the run is still working

#### Scenario: Unknown step kind
- **WHEN** a step of a kind the UI does not know arrives
- **THEN** it is shown generically with its kind and output instead of being dropped

#### Scenario: Step details
- **WHEN** the operator expands a step
- **THEN** its structured output is shown with labelled fields

#### Scenario: Policy check step
- **WHEN** a policy-check step is shown
- **THEN** it lists what was sent, under which data-sharing tier, and what was withheld

### Requirement: Hypotheses
The run view SHALL show the hypotheses with their confidence as a percentage and evidence; once validated, validated hypotheses SHALL replace the unvalidated ones and show their validation notes.

#### Scenario: Validated hypotheses
- **WHEN** validation has completed
- **THEN** the validated hypotheses are shown, ordered by confidence, each with confidence, evidence and validation notes

### Requirement: Decision
Once the agent has decided, the run view SHALL show a decision card with root cause, recommended action and confidence.

#### Scenario: Decision available
- **WHEN** the decision step has completed with a root cause
- **THEN** the decision card shows root cause, recommended action and confidence

### Requirement: State panels
For each waiting state the run view SHALL show one panel with the information that state carries and only the actions valid in it; after an action the view SHALL follow the run to its next state without a reload.

#### Scenario: Clarification needed
- **WHEN** the run is in `awaiting_input`
- **THEN** a panel shows the agent's question and confidence and lets the operator add text and attach files and submit, or escalate to the machine builder

#### Scenario: Submit clarification
- **WHEN** the operator submits a clarification
- **THEN** the run returns to running and new steps stream in

#### Scenario: Confirm resolution
- **WHEN** the run is in `awaiting_confirmation`
- **THEN** a panel shows root cause, recommended action and previously rejected resolutions, and lets the operator confirm, reject with a reason and optional files, or escalate to the machine builder

#### Scenario: Reject resolution
- **WHEN** the operator rejects the proposed resolution with a reason
- **THEN** a new analysis round starts and the rejected resolution is listed in the next confirmation panel

#### Scenario: Recommendation review
- **WHEN** the run is in `awaiting_recommendation_review`
- **THEN** a panel shows the machine builder's summary and ordered action items and lets the operator answer resolved, still failing, or escalate

#### Scenario: Operator approval
- **WHEN** the run is in `awaiting_operator_approval`
- **THEN** a panel shows what the machine builder requested, what falls within the data-sharing tier and is sent automatically, and what needs approval, and lets the operator approve or decline with an optional note

#### Scenario: Action fails
- **WHEN** an action in a state panel fails
- **THEN** the panel stays, keeps the operator's input and shows the reason

### Requirement: Escalation pre-flight
Before escalating, the UI SHALL show who would receive the incident, which data would be sent and under which data-sharing tier, or why escalation is not possible, and ask for confirmation.

#### Scenario: Escalation possible
- **WHEN** the operator chooses to escalate
- **THEN** a dialog shows the recipient, the data to be sent and the tier, and escalation starts only after confirmation

#### Scenario: Escalation not possible
- **WHEN** escalation is not possible
- **THEN** the dialog explains why and offers no confirm action

### Requirement: Run outcomes
The run view SHALL show completed, failed, stopped and closed-by-machine-builder outcomes with their details, and offer reopen and archive where the run allows them.

#### Scenario: Completed
- **WHEN** a run completes
- **THEN** the view shows the final decision and that the incident was logged, and offers to archive

#### Scenario: Failed
- **WHEN** a run fails
- **THEN** the view shows the error and offers to archive, and to reopen when a conversation exists

#### Scenario: Closed by machine builder
- **WHEN** the run is in `mb_closed`
- **THEN** the view shows the close outcome and reason and offers reopen (unless the outcome is not reopenable) and archive

### Requirement: Stop, reopen and archive
The operator SHALL be able to stop an open run, reopen a stopped or closed run that has a conversation, and archive a finished run, each after confirmation.

#### Scenario: Stop a run
- **WHEN** the operator stops a run and confirms
- **THEN** the run becomes stopped and the view shows the stopped outcome

#### Scenario: Reopen
- **WHEN** the operator reopens a stopped run that has a machine-builder conversation
- **THEN** the run returns to `awaiting_machine_builder` and the conversation continues

#### Scenario: Archive
- **WHEN** the operator archives a finished run
- **THEN** it disappears from the active list and is available in the incident history

### Requirement: Live connection resilience
The run view SHALL recover the run's current state after a lost connection without a reload.

#### Scenario: Connection drops while waiting
- **WHEN** the live connection drops while the run waits for an external party
- **THEN** the view indicates reconnection and, once recovered, shows the run's current state including anything that changed meanwhile
