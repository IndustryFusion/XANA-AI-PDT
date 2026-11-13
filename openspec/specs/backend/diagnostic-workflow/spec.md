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
The observe step SHALL read the machine and its directly related entities from the context broker, and their recent attribute history, relationship and text changes and entity lifecycle from the time-series store. History SHALL include rows where the deleted flag is null. It SHALL report what it read, per source, with that source's status.

#### Scenario: Machine with components
- **WHEN** the observed machine has relationships to two components
- **THEN** the step's content includes the machine's and both components' current values. It lists the signals considered with name, value, unit and recent trend, and reports both sources as `ok`.

#### Scenario: Unknown machine
- **WHEN** the context broker has no entity with the given machine identifier
- **THEN** the step reports the machine as not found and the round continues with the issue text and any history found

#### Scenario: Relationship and text changes
- **WHEN** a relationship target or a text attribute changed within the window
- **THEN** the step's content lists those changes, newest first, with their time

#### Scenario: Entity lifecycle
- **WHEN** a related entity was created or deleted within the window
- **THEN** the step's content lists that with its time

#### Scenario: Null deleted flag
- **WHEN** history rows have a null deleted flag
- **THEN** they count as not deleted

#### Scenario: Attributes named by full IRIs
- **WHEN** an entity's attributes are full IRIs and history holds the same IRIs
- **THEN** each signal appears once, with its current value and trend

#### Scenario: Changes cannot be read
- **WHEN** reading changes or lifecycle fails, or the entities table does not exist
- **THEN** the round continues with the rest, and the step says so

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
When the language model does not answer within its timeout, or gives an answer that does not match the expected structure on the first try and on three retries, the round SHALL fail with the failing step and a readable reason.

#### Scenario: Timeout
- **WHEN** the model does not answer during the validate step within the timeout
- **THEN** the outcome is failed, with step `validate` and a reason that names the timeout

#### Scenario: Malformed answer
- **WHEN** the model's first answer in a step does not match the expected structure
- **THEN** the step asks again, up to three times. If an answer matches, the round continues; otherwise it fails with that step and a reason that says the structure did not match.

### Requirement: Read-only towards the factory
The workflow SHALL only read from the context broker and the time-series store. Text from the issue, a clarification or a rejection reason SHALL be treated as data, never as instructions that change which data the workflow may access.

#### Scenario: No writes
- **WHEN** any round runs
- **THEN** no request that creates, changes or deletes data is sent to the context broker or the time-series store

#### Scenario: Instruction in the issue text
- **WHEN** the issue text asks the agent to delete an entity or to query another machine's data
- **THEN** no write happens, and only the run's machine, its related entities and their history are read

### Requirement: Active alerts as evidence
The observe step SHALL read `open` and `ack` alerts for the machine and up to 5 related entities, by their full entity IDs, remove duplicates, weight them by age and severity, and pass them to the hypothesize step. They SHALL be part of the run's evidence, and of the machine data the round keeps. A workflow without an alert source SHALL work as before.

#### Scenario: Machine with an active alert
- **WHEN** the machine has an open alert whose resource is its full entity ID
- **THEN** the observe step lists it, the hypothesize step receives it, and Alerta shows as `ok`

#### Scenario: Alert in the form of the platform's rules
- **WHEN** an alert has the form the platform's rules produce
- **THEN** it is found by the full entity ID

#### Scenario: Other statuses
- **WHEN** an alert is closed or shelved
- **THEN** it is not listed

#### Scenario: Duplicates
- **WHEN** the same alert is returned for more than one read
- **THEN** it is listed once

#### Scenario: Age
- **WHEN** two alerts of the same severity differ in age
- **THEN** the newer one has the higher weight and comes first

#### Scenario: Many related entities
- **WHEN** the machine has more than 5 related entities
- **THEN** alerts are read for the machine and 5 of them

#### Scenario: One entity fails
- **WHEN** reading alerts fails for one entity
- **THEN** alerts of the others are listed, the source shows as `unavailable` and says how many failed, and the round continues

#### Scenario: Alerta unavailable
- **WHEN** Alerta cannot be reached
- **THEN** the round reaches a decision, and the source shows as `unavailable`

#### Scenario: Only reads
- **WHEN** any round runs
- **THEN** only read requests are sent to Alerta

### Requirement: Declared values in observations
The observe step SHALL read a property value that the context broker returns as a value object -- `@value` with its datatype as `type` or `@type` -- as that `@value`, and a number written as a string inside a value object of a numeric datatype as that number. A declared number SHALL count as a signal like a plain one, and the facts given to the model SHALL carry the plain value.

#### Scenario: Declared double as a signal
- **WHEN** the observed machine's `temperature` is `{"type": "http://www.w3.org/2001/XMLSchema#double", "@value": 42.5}` with unit `CEL`
- **THEN** the step lists `temperature` among the signals with value 42.5, unit `CEL` and its recent trend

#### Scenario: Declared number written as a string
- **WHEN** the `temperature` is `{"type": "http://www.w3.org/2001/XMLSchema#double", "@value": "42.5"}`
- **THEN** the step lists it as the signal value 42.5

#### Scenario: Facts carry the plain value
- **WHEN** the step describes the machine to the model
- **THEN** the `temperature` fact reads 42.5 with its unit, without the datatype

#### Scenario: Plain and declared values together
- **WHEN** one attribute is a plain number and another a declared double
- **THEN** both are listed as signals, each once
