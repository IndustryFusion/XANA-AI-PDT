# Delta for Explorer API

## MODIFIED Requirements

### Requirement: Many entities at once
The backend SHALL give the entities of a list of IDs, and the latest states of their attributes, in one request each, up to 1,000 IDs of at most 2,048 characters each. It SHALL read the broker for up to 100 entities per query, and the time series for at most four entities at once. An ID without an entity SHALL be left out of the answer.

#### Scenario: Many entities
- **WHEN** 250 existing entities and one ID without an entity are asked for in one request
- **THEN** the 250 entities are returned by ID, the missing one is left out, and the broker was asked three times

#### Scenario: An ID the broker's list can't hold
- **WHEN** an ID contains a comma
- **THEN** that entity is read on its own and returned with the others

#### Scenario: An ID the broker refuses
- **WHEN** the broker refuses a list of IDs because of one of them
- **THEN** the other entities of the list are returned, and the refused ID is left out

#### Scenario: Latest states that can't be read
- **WHEN** the latest states of one of the entities asked for can't be read because the time series doesn't know or refuses that entity
- **THEN** that entity is left out, and the others' states are returned

#### Scenario: Time series failing
- **WHEN** the time series fails or can't be reached while the latest states of many entities are read
- **THEN** the request fails as a read of one entity's states does, and the reads still running stop

#### Scenario: Too many IDs
- **WHEN** more than 1,000 IDs are asked for in one request
- **THEN** the request is refused as invalid

#### Scenario: An ID too long
- **WHEN** an ID longer than 2,048 characters is among the IDs asked for
- **THEN** the request is refused as invalid, and nothing is sent to the broker or the time series

#### Scenario: Latest states of many entities
- **WHEN** the latest attribute states of many entities are asked for in one request
- **THEN** each entity's states are returned by ID, as for one entity, and no more than four entities' rows are read from the time series at once
