# Spec Delta

## Purpose

Supports the structured exchange between the factory operator and the machine builder after an incident is escalated through the dataspace, while keeping data sharing visible and under the operator's control.

## ADDED Requirements

### Requirement: Conversation view after escalation
Once a run is escalated, the run view SHALL offer two views: diagnostics and the conversation with the machine builder, and SHALL switch to the conversation when escalation starts.

#### Scenario: Escalation opens the conversation
- **WHEN** a run is escalated
- **THEN** the conversation view is shown, and the diagnostics view remains available

#### Scenario: Unread messages
- **WHEN** the machine builder sends a message while the diagnostics view is shown
- **THEN** the conversation view's entry shows the number of unread messages

### Requirement: Message thread
The conversation SHALL show agent, operator and machine-builder messages in time order with sender, time, kind of act, and for messages sent by the operator their delivery status.

#### Scenario: Thread with delivery status
- **WHEN** the conversation is shown
- **THEN** every message shows its sender, time and act, and every outgoing message shows whether it is pending, delivered or failed

#### Scenario: Empty thread
- **WHEN** no message has been exchanged yet
- **THEN** the thread says so and shows what was sent with the escalation

### Requirement: Structured acts
The operator SHALL be able to send structured acts (inform, request, grant or deny a pending request, ask for direct contact, end direct contact, close with an outcome, cancel), offered only when valid in the conversation's current state.

#### Scenario: Acts depend on state
- **WHEN** the conversation is open
- **THEN** inform, request, ask for direct contact, close and cancel are offered, and grant or deny only while a request is pending

#### Scenario: Close with outcome
- **WHEN** the operator closes the conversation and chooses an outcome
- **THEN** the conversation shows it as closed with that outcome and the run becomes stopped

#### Scenario: Direct contact requested by the machine builder
- **WHEN** the machine builder asks for direct contact
- **THEN** the conversation shows this state and does not offer close or end direct contact to the operator

#### Scenario: Close as escalated
- **WHEN** direct contact was requested by the operator and the operator closes with outcome escalated
- **THEN** the run is stopped and is not reopenable

### Requirement: Suggested actions
The conversation SHALL show suggested next acts proposed by the incident agent, which the operator can use as a starting point.

#### Scenario: Use a suggestion
- **WHEN** the operator chooses a suggested action
- **THEN** the corresponding act is prepared with the suggested text for review before sending

### Requirement: Questions to the incident agent
The operator SHALL be able to ask the incident agent free-text questions about the conversation and see the answers in the thread, marked as agent messages.

#### Scenario: Ask the agent
- **WHEN** the operator sends a question to the incident agent
- **THEN** the question and the agent's answer appear in the thread, and nothing is sent to the machine builder

### Requirement: Policy-gated data requests
When the machine builder requests data, the conversation SHALL show whether the request is within the configured data-sharing tier; requests beyond the tier SHALL wait for the operator's approval.

#### Scenario: Request within the tier
- **WHEN** the machine builder requests data within the tier
- **THEN** the data is sent automatically and a policy-check entry shows what was sent

#### Scenario: Request beyond the tier
- **WHEN** the machine builder requests data beyond the tier
- **THEN** the run moves to `awaiting_operator_approval` and nothing beyond the tier is sent until the operator approves

### Requirement: Conversation status check
The operator SHALL be able to check whether the machine builder has closed the conversation, and record a close manually when it was communicated outside the application.

#### Scenario: Check status
- **WHEN** the operator checks the conversation status and the machine builder has closed it
- **THEN** the run moves to `mb_closed` with the outcome and reason

#### Scenario: Record a close
- **WHEN** the operator records a close with outcome and reason and confirms
- **THEN** the run moves to `mb_closed` and the thread notes that the close was recorded by the operator
