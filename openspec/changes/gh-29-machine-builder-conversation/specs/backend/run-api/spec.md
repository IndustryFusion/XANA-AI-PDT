# Spec Delta

## ADDED Requirements

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
