# Spec Delta

## ADDED Requirements

### Requirement: Close outcomes offered
The close form SHALL offer resolved, not resolved, rejected, timed out and escalated in an open conversation and in one the operator escalated, and SHALL show what happened when an escalated close stops part way.

#### Scenario: Outcomes in an open conversation
- **WHEN** the operator chooses to close an open conversation
- **THEN** resolved, not resolved, rejected, timed out and escalated are offered

#### Scenario: Close as escalated from open
- **WHEN** the operator closes an open conversation as escalated and confirms
- **THEN** the thread shows the `escalate` and then the `close`, and the run is stopped and not reopenable

#### Scenario: Escalate refused
- **WHEN** the `escalate` of an escalated close is refused or not delivered
- **THEN** the form stays with the reason, and the thread shows the `escalate`'s delivery
