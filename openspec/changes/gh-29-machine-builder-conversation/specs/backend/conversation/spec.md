# Spec Delta

## ADDED Requirements

### Requirement: Receiving
The backend SHALL poll the inbox every `INBOX_POLL_INTERVAL_S`, store what arrives, and acknowledge it only after it is stored. It SHALL handle a message once.

#### Scenario: Received
- **WHEN** a message for a run's conversation is received
- **THEN** it appears as a `message` step with sender, act, text and conversation state, and is acknowledged

#### Scenario: Processing fails
- **WHEN** storing, reading the conversation or the download fails
- **THEN** the message is not acknowledged, and is handled at the next poll

#### Scenario: Restart before acknowledging
- **WHEN** the backend stops after storing a message and before acknowledging it
- **THEN** after the restart it is acknowledged, and appears once

#### Scenario: Unknown conversation
- **WHEN** a message belongs to no run or incident
- **THEN** it isn't acknowledged, and nothing fails

#### Scenario: After archiving
- **WHEN** a message arrives for an archived incident
- **THEN** it is added to the incident's record and acknowledged

#### Scenario: Files
- **WHEN** a message has files
- **THEN** they are downloaded and stored, and the operator can get them

### Requirement: Routing by performative
Each performative received SHALL have its effect, with the state from `GET /conversations/{id}`.

#### Scenario: request naming a capability
- **WHEN** `request` names a capability
- **THEN** the run moves to `awaiting_operator_approval`, showing what is within the tier and what needs approval, and nothing is sent

#### Scenario: request in free text
- **WHEN** `request` names no capability
- **THEN** it shows as a request, and the run keeps waiting

#### Scenario: inform
- **WHEN** `inform` has no recommendation
- **THEN** it is shown, and the run keeps waiting

#### Scenario: inform with a recommendation
- **WHEN** `inform` has `recommendation` in its payload, as a text or with `summary` and `actions`
- **THEN** the run moves to `awaiting_recommendation_review` with them

#### Scenario: grant and deny
- **WHEN** `grant` or `deny` answers the operator's request
- **THEN** it is shown, with the capability, and the run keeps waiting

#### Scenario: cancel
- **WHEN** `cancel` names a data request that is waiting
- **THEN** that request is no longer waiting

#### Scenario: close
- **WHEN** `close` arrives
- **THEN** the run moves to `mb_closed` with the outcome and reason, and isn't reopenable after `escalated` or `superseded`

#### Scenario: escalate and deescalate
- **WHEN** `escalate` or `deescalate` arrives
- **THEN** the conversation shows direct contact by the machine builder, or open again

#### Scenario: reopen
- **WHEN** `reopen` arrives for a closed run
- **THEN** the run waits for the machine builder again

### Requirement: Sending with the operator's confirmation
Nothing SHALL be sent to a peer except by an operator's request.

#### Scenario: Acts
- **WHEN** an operator sends `inform`, `request`, `escalate`, `deescalate` or `close`
- **THEN** that performative is sent in the conversation, appears as a message step, and its delivery is shown

#### Scenario: Refused by the conversation's rules
- **WHEN** the gateway refuses with `409` or `422`
- **THEN** the operator gets a `conflict` or `invalid` with the reason, and no step says it was sent

#### Scenario: Grant
- **WHEN** an operator approves a data request
- **THEN** access is approved, `grant` is sent with an authorization, and then only that capability's data, in reply, with a policy check

#### Scenario: Grant fails after the message
- **WHEN** `grant` was sent and the files fail
- **THEN** the failure is shown, and approving again sends only the files

#### Scenario: Deny
- **WHEN** an operator declines
- **THEN** `deny` is sent, and no data

#### Scenario: Recommendation answered
- **WHEN** an operator answers `resolved`, `still_failing` or `escalate`
- **THEN** `resolved` closes as `resolved` and completes the run, `still_failing` sends `inform` and waits, and `escalate` sends `escalate` and waits

### Requirement: Status of a conversation
The operator SHALL be able to check the conversation's state, and record a close communicated elsewhere.

#### Scenario: Check finds it closed
- **WHEN** the conversation is closed at the gateway and the operator checks
- **THEN** the run moves to `mb_closed`

#### Scenario: Record a close
- **WHEN** the operator records a close with outcome and reason
- **THEN** the run moves to `mb_closed`, noted as recorded by the operator, and nothing is sent

### Requirement: Restart
A restart SHALL lose nothing.

#### Scenario: Mid-conversation
- **WHEN** the backend restarts in mid-conversation
- **THEN** the run has every step and status, what arrived meanwhile is handled, and nothing is handled twice

#### Scenario: Sent, and stopped before storing
- **WHEN** a message was accepted by the gateway, and the backend stopped before storing it
- **THEN** after the restart it appears in the run from `GET /conversations/{id}`
