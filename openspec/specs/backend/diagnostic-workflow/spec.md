# backend/diagnostic-workflow Specification

## Purpose
Defines the agent that diagnoses an issue on one machine: it observes the machine and its data, forms and validates hypotheses, and proposes a root cause only when confident enough, otherwise asks the operator; it logs an incident only after the operator confirms, and never writes to the factory.

## Requirements

### Requirement: Usable on its own
The diagnostic workflow SHALL be usable by a program without the backend service. The program supplies a machine identifier, an issue description, a language model and the data sources, and receives every completed step and the round's outcome.

#### Scenario: Run outside the service
- **WHEN** a program runs the workflow for a machine and an issue with the scripted language model and in-memory data sources
- **THEN** it receives the completed steps in order and an outcome, without starting the backend service and without any network access

#### Scenario: Steps delivered as they complete
- **WHEN** a round is running
- **THEN** each step is delivered to the program when that step completes, before the next step starts

### Requirement: Directed analysis round
An analysis round SHALL run the steps observe, hypothesize, validate and decide in this order. Each step SHALL produce structured content, never free-form text only.

#### Scenario: Full round
- **WHEN** a round runs for a machine with available data
- **THEN** exactly one observe, one hypothesize, one validate and one decide step complete, in this order

### Requirement: Observe the machine
The observe step SHALL read the machine and its directly related entities from the context broker, and their recent attribute history from the time-series store. It SHALL report what it read, per source, with that source's status.

#### Scenario: Machine with components
- **WHEN** the observed machine has relationships to two components
- **THEN** the step's content includes the machine's and both components' current values. It lists the signals considered with name, value, unit and recent trend, and reports both sources as `ok`.

#### Scenario: Unknown machine
- **WHEN** the context broker has no entity with the given machine identifier
- **THEN** the step reports the machine as not found and the round continues with the issue text and any history found

### Requirement: Hypotheses
The hypothesize step SHALL propose two or three hypotheses for the issue, ranked by confidence. Each has a title, a confidence and the observed evidence it rests on.

#### Scenario: Ranked hypotheses
- **WHEN** the hypothesize step completes
- **THEN** it holds two or three hypotheses ordered from highest to lowest confidence, each with title, confidence and evidence

### Requirement: Validation against data
The validate step SHALL check each hypothesis against the machine's data with a bounded number of targeted queries. It SHALL assign each hypothesis a verdict (`confirmed`, `plausible`, `inconclusive` or `refuted`), an updated confidence and notes that cite the data used or name the data that was missing.

#### Scenario: Hypotheses validated
- **WHEN** the validate step completes
- **THEN** every hypothesis carries a verdict, an updated confidence and validation notes, ordered by confidence

#### Scenario: Bounded checks
- **WHEN** the language model plans more checks than allowed
- **THEN** at most six history queries and three entity lookups are run per round

### Requirement: Confidence normalisation
Every confidence value SHALL be a number between 0 and 1. A model answer between 1 and 100 SHALL be read as a percentage.

#### Scenario: Percentage answer
- **WHEN** the language model returns a confidence of `70`
- **THEN** the step content holds `0.7`

#### Scenario: Out of range
- **WHEN** the language model returns a confidence of `-0.2` or `250`
- **THEN** the value is clamped to `0` or `1` respectively

### Requirement: Confidence-gated decision
The decide step SHALL take the decision confidence from the highest validated hypothesis confidence, and SHALL compare it with the configured threshold. Below the threshold, the round SHALL end waiting for operator input with a question naming the missing information. At or above the threshold, the round SHALL end waiting for confirmation of a root cause and a recommended action.

#### Scenario: Low confidence
- **WHEN** the highest validated confidence is `0.6` and the threshold is `0.9`
- **THEN** the decide step holds confidence `0.6`, the threshold and a question, and the round's outcome is waiting for input

#### Scenario: Sufficient confidence
- **WHEN** the highest validated confidence is `0.92` and the threshold is `0.9`
- **THEN** the decide step holds a root cause, a recommended action, confidence `0.92` and the threshold, and the round's outcome is waiting for confirmation

#### Scenario: Past incidents considered
- **WHEN** incident memory holds resolved incidents for the same machine
- **THEN** the decide step lists up to three of them with their root cause and resolution as context for the decision

### Requirement: Logging only after confirmation
The workflow SHALL write an incident to memory only after the operator has confirmed the proposed resolution. The incident holds the machine, the issue, the confirmed root cause, the recommended action and the full step trace.

#### Scenario: Confirmed
- **WHEN** the operator confirms the proposed resolution
- **THEN** an act step completes, the incident is stored in memory with its trace, and the outcome is completed

#### Scenario: Not confirmed
- **WHEN** a round ends waiting for confirmation or input
- **THEN** nothing has been written to incident memory

### Requirement: Clarification round
When the operator adds information to a run waiting for input, the workflow SHALL run a new round that includes that information.

#### Scenario: Clarified
- **WHEN** the operator adds "the noise started after the filter change"
- **THEN** a new round runs from observe, and its hypothesize step's input includes the clarification

### Requirement: Rejection round
When the operator rejects a proposed resolution with a reason, the workflow SHALL run a new round. In that round, no rejected root cause is proposed as the decision again.

#### Scenario: Rejected once
- **WHEN** the operator rejects root cause A with a reason
- **THEN** a new round runs whose hypothesize step's input lists A and the reason, and whose decision, if confident, names a root cause other than A

#### Scenario: Rejected list kept
- **WHEN** the operator has rejected two resolutions in successive rounds
- **THEN** the next round's input lists both, each with its reason

### Requirement: Graceful degradation
When the context broker, the time-series store or incident memory cannot be reached, the workflow SHALL continue with the data it has and mark the affected source in the step content.

#### Scenario: Time-series store down
- **WHEN** the time-series store is unreachable during a round
- **THEN** the observe step reports that source as `unavailable` and marks the data as partial. Validation notes name the missing history, and the round reaches a decision.

#### Scenario: Memory down
- **WHEN** incident memory is unreachable during the decide step
- **THEN** the decision is made without past incidents, and the step says so

### Requirement: Model failure
When the language model does not answer within its timeout, or twice in a row gives an answer that does not match the expected structure, the round SHALL fail with the failing step and a readable reason.

#### Scenario: Timeout
- **WHEN** the model does not answer during the validate step within the timeout
- **THEN** the outcome is failed, with step `validate` and a reason that names the timeout

#### Scenario: Malformed answer
- **WHEN** the model's first answer in a step does not match the expected structure
- **THEN** the step asks once more. If the second answer matches, the round continues; otherwise it fails with that step.

### Requirement: Read-only towards the factory
The workflow SHALL only read from the context broker and the time-series store. Text from the issue, a clarification or a rejection reason SHALL be treated as data, never as instructions that change which data the workflow may access.

#### Scenario: No writes
- **WHEN** any round runs
- **THEN** no request that creates, changes or deletes data is sent to the context broker or the time-series store

#### Scenario: Instruction in the issue text
- **WHEN** the issue text asks the agent to delete an entity or to query another machine's data
- **THEN** no write happens, and only the run's machine, its related entities and their history are read
