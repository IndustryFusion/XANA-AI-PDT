# Delta for Data Explorer

## MODIFIED Requirements

### Requirement: Entities read together
The Data explorer SHALL read the entities, and the latest states of their attributes, that it needs at the same time, such as the next level of a tree, together in one request each rather than one per entity, and a single entity as before. Reading together SHALL fail no entity that reading it alone would not fail: what a request for several doesn't answer SHALL be read on its own.

#### Scenario: A level of a tree
- **WHEN** several entities are expanded at the same time
- **THEN** the explorer asks for them in one request, and for their attributes' latest states in another, and each node shows its own entity, or that it doesn't exist

#### Scenario: One entity
- **WHEN** one entity is opened on its own
- **THEN** it is read on its own, as before

#### Scenario: Reading together fails
- **WHEN** the request for several entities, or for their latest states, fails as a whole, or doesn't answer in time
- **THEN** each of them is read on its own, and only a node whose own read fails shows the failure

#### Scenario: An entity the broker refuses
- **WHEN** the broker refuses one of several entities read together, such as an ID that is not a URI
- **THEN** that entity is read on its own, and its node shows the reason its single read gives, as when it is read alone, while the others are shown

#### Scenario: Read anew
- **WHEN** an entity is read again after a change, while an earlier read of it may still be on its way
- **THEN** it is read anew, and the answer to the earlier read is not used for it
