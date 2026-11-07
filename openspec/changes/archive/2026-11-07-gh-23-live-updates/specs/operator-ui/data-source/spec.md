# Spec Delta

## ADDED Requirements

### Requirement: Live updates from the backend
The backend data source SHALL serve `subscribeEntities` and `getLiveUpdateHealth` from the backend.

#### Scenario: Events
- **WHEN** the backend streams a change
- **THEN** the subscriber receives an `update` event with the entity's ID and its attributes, with names unchanged

#### Scenario: Lost stream
- **WHEN** the stream closes or cannot open
- **THEN** the subscriber receives one `error` event of kind `unavailable`, and no further events

#### Scenario: Unsubscribing
- **WHEN** the screen unsubscribes
- **THEN** the stream is closed, and no more events arrive
