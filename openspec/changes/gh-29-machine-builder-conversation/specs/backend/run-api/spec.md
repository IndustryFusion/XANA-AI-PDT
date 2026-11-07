# Spec Delta

## ADDED Requirements

### Requirement: Stop and reopen with a conversation
Stopping and reopening SHALL act on the conversation.

#### Scenario: Stop
- **WHEN** a run with an open conversation is stopped
- **THEN** `close(withdrawn)` is sent, and the run is reopenable

#### Scenario: Stop with the gateway failing
- **WHEN** the close can't be sent
- **THEN** the run stops, says so, and the close is sent when it can be

#### Scenario: Reopen a run
- **WHEN** a stopped or `mb_closed` run with a conversation is reopened
- **THEN** `reopen` is sent, and it waits for the machine builder

#### Scenario: Not reopenable
- **WHEN** the conversation was closed as `escalated` or `superseded`, or the run has none
- **THEN** reopening is refused as `conflict`, and nothing is sent

#### Scenario: Reopen an incident
- **WHEN** an archived incident with a conversation is reopened
- **THEN** a new run continues its conversation, with its messages, waiting for the machine builder
