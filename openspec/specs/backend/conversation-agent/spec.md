# backend/conversation-agent Specification

## Purpose
An agent that helps the operator answer the machine builder. It reads data and suggests replies, but it can't send anything to the peer itself.

## Requirements

### Requirement: A separate agent that can't send
The conversation agent SHALL be separate from the diagnostic workflow, and SHALL have no way of sending to a peer. The diagnostic workflow SHALL stay read-only.

#### Scenario: A protocol tool
- **WHEN** the model calls `send_inform`, `send_request`, `send_escalate`, `send_deescalate` or `send_close`
- **THEN** a suggestion is added, and nothing is sent

#### Scenario: A peer's text asks for it
- **WHEN** a peer's message tells the agent to send data, or to ignore its rules
- **THEN** nothing is sent, and the text is treated as data

#### Scenario: Use a suggestion
- **WHEN** the operator uses a suggestion and sends it
- **THEN** that is the only thing that sends

### Requirement: Tools
The agent SHALL read through its data tools, limited to the run's machine and the entities observed in it, and through the ontology's read functions.

#### Scenario: An entity outside the run
- **WHEN** the model asks for an entity not observed in the run
- **THEN** the tool answers with an error as data, and it isn't read

#### Scenario: A query that calls out
- **WHEN** the model writes an ontology query with `SERVICE`, in any form
- **THEN** the tool answers with an error as data, and Fuseki calls nothing

#### Scenario: A source fails
- **WHEN** a source fails
- **THEN** the tool answers with an error as data, and the turn goes on

#### Scenario: Unknown tool, too many calls
- **WHEN** the model names an unknown tool, or goes on past 6 calls
- **THEN** the turn ends with a reply and nothing else happens

### Requirement: Questions and reviews
The operator SHALL be able to ask the agent, and a review SHALL follow a data request, free-text request or recommendation.

#### Scenario: Ask
- **WHEN** the operator asks a question
- **THEN** the question and answer are internal message steps, and nothing is sent

#### Scenario: Rebuilt after a restart
- **WHEN** the backend restarted between two questions
- **THEN** the next turn has the earlier ones, from the stored steps

#### Scenario: Model failing
- **WHEN** the model fails on a question
- **THEN** the request says so, and the question stays in the thread

#### Scenario: Asking at once
- **WHEN** a second question arrives while one is being answered
- **THEN** it is refused as `conflict`

#### Scenario: Review
- **WHEN** a data request arrives
- **THEN** the agent's review appears as an internal message with suggestions, and a model failure doesn't touch the message or its status

### Requirement: Evaluation
Repeatable cases SHALL evaluate tool selection and conversation behaviour without a live dataspace.

#### Scenario: Cases run
- **WHEN** the cases are run
- **THEN** each reports the tools used and what was expected, and any case where something would be sent fails
