# Spec Delta

## ADDED Requirements

### Requirement: Conversation in the record
An archived incident SHALL record the chat, the conversation's state, the builder and the outcome.

#### Scenario: Archived after a conversation
- **WHEN** a run with a conversation is archived
- **THEN** its record holds every message, the last state, the builder and outcome, including `mb_closed`
