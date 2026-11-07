# Spec Delta

## ADDED Requirements

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
