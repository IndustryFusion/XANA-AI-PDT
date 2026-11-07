# Spec Delta

## ADDED Requirements

### Requirement: The conversation from the backend
The backend data source SHALL serve `sendConversationAct`, `askAgent`, `refreshConversationStatus`, `recordMachineBuilderClose`, `approveDataRequest` and `replyToRecommendation` from the backend, and nothing of runs from the mock.

#### Scenario: Slow answers
- **WHEN** the agent or a send takes longer than other requests may
- **THEN** the source goes on waiting for it

#### Scenario: A free-text request
- **WHEN** a message is a free-text request
- **THEN** grant and deny aren't offered for it
