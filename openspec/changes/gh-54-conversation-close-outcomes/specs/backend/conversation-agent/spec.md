# Spec Delta

## ADDED Requirements

### Requirement: The run's diagnosis
Each turn of the conversation agent SHALL get the run's latest diagnosis: root cause, confidence, the three hypotheses with the highest confidence, and the machine's active alerts as the run observed them.

#### Scenario: Asked what XANA diagnosed
- **WHEN** the operator asks the agent what XANA diagnosed
- **THEN** the answer gives the run's root cause and confidence, without a tool call being needed (evaluation case)

#### Scenario: Reopened run
- **WHEN** a run has had more than one round
- **THEN** the turn gets the diagnosis of the latest round

#### Scenario: No diagnosis yet
- **WHEN** the run has no diagnosis
- **THEN** the turn says so, and the agent doesn't make one up (evaluation case)

#### Scenario: Not sent
- **WHEN** the agent answers with the diagnosis in its context
- **THEN** nothing is sent to the machine builder
