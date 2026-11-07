# Spec Delta

## ADDED Requirements

### Requirement: Close outcomes
An operator's close SHALL offer the outcomes `resolved`, `not_resolved` (sent as `failed`), `rejected`, `timed_out` and `escalated`, in an open conversation and in one this side escalated, and SHALL record the outcome in the run and the incident.

#### Scenario: Each outcome on a real dataspace
- **WHEN** the operator closes conversations with each of `resolved`, `not_resolved`, `rejected`, `timed_out` and `escalated`
- **THEN** the dataspace accepts each close, both sides read the closed state for that outcome, and the archived incident holds the outcome

#### Scenario: Unknown outcome
- **WHEN** a close names another outcome, or none
- **THEN** it is refused as `invalid`, and nothing is sent

#### Scenario: Machine builder escalated
- **WHEN** the operator closes while the machine builder has escalated the conversation
- **THEN** it is refused as `conflict`, and nothing is sent

### Requirement: Escalated close from an open conversation
When the operator closes an open conversation as `escalated`, the backend SHALL send `escalate` first, and SHALL send `close` with outcome `escalated` only once the machine builder's side has accepted the `escalate`.

#### Scenario: From OPEN on a real dataspace
- **WHEN** the operator closes an `OPEN` conversation as `escalated`
- **THEN** `escalate` and then `close` are sent, each appears as a message step, both sides reach `CLOSED_ESCALATED`, and the run is stopped and not reopenable

#### Scenario: Already escalating
- **WHEN** this side escalated the conversation earlier and the operator closes as `escalated`
- **THEN** only `close` is sent

#### Scenario: Escalate refused
- **WHEN** the gateway refuses the `escalate`
- **THEN** no `close` is sent, and the operator gets the refusal's reason

#### Scenario: Escalate not delivered
- **WHEN** the `escalate` is accepted, and its notification ends as `error` or `rejected`
- **THEN** no `close` is sent, the operator is told that the machine builder did not get the escalation, and closing again sends the `escalate` again first

#### Scenario: Escalate still on its way
- **WHEN** the `escalate` has not been notified after 60 seconds
- **THEN** no `close` is sent, and the operator is told to close again once it has arrived

#### Scenario: Escalations crossing
- **WHEN** the machine builder's `escalate` crosses this side's and wins
- **THEN** no `close` is sent, and the conversation shows that the machine builder escalated

#### Scenario: Nothing in between
- **WHEN** the operator sends another act while an escalated close is under way
- **THEN** it is refused as `conflict`
