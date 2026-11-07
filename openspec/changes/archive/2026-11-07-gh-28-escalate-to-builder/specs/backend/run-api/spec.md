# Spec Delta

## ADDED Requirements

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
