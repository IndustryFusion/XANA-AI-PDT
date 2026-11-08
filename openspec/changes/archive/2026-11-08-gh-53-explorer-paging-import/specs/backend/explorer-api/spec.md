# Spec Delta

## MODIFIED Requirements

### Requirement: Import
The backend SHALL create or replace a list of entities and report the result per entity. An entity that already exists SHALL be replaced, so attributes not in the imported entity are removed. When only some succeed, it SHALL answer HTTP 207.

#### Scenario: New and existing entities
- **WHEN** a list holds a new entity and an existing one
- **THEN** the first is reported as `created` and the second as `updated`, and the second holds exactly the attributes of the imported entity

#### Scenario: Attribute removed from the file
- **WHEN** an entity is imported, and imported again without one of its attributes, on a real context broker
- **THEN** the entity no longer has that attribute

#### Scenario: Partial failure
- **WHEN** one entity of a list is rejected
- **THEN** the answer is HTTP 207, that entity is `failed` with the reason, and the others are imported

#### Scenario: Entities with and without a context
- **WHEN** a list mixes entities without a context and entities with an allowed context
- **THEN** both kinds are imported

#### Scenario: Context that isn't allowed
- **WHEN** an entity names, at any level, a remote context other than the ETSI core context or a configured one, whether it came from a file or a fetched document
- **THEN** that entity fails, the request does not reach the context broker, and the reason does not hold the address

#### Scenario: Internal addresses in a broker's reason
- **WHEN** the broker's reason for rejecting an entity holds an address
- **THEN** the address is left out of what the caller gets, with or without a scheme, such as `scorpio.svc.cluster.local:9090 [/10.0.0.5]`

#### Scenario: A document that can't be carried
- **WHEN** a document is nested too deeply, or holds a lone surrogate
- **THEN** the request is refused as `invalid`, without a server error

## ADDED Requirements

### Requirement: Paging
The entities query SHALL take an `offset` with the `limit`, and SHALL report the total number of matches when it is known.

#### Scenario: Paging to the end
- **WHEN** a query has more matches than the limit on a real context broker, and the caller asks with offsets 0, limit, twice the limit and so on
- **THEN** the pages together hold every match once, the total is reported, and the page after the last is empty

#### Scenario: Expression evaluated by the backend
- **WHEN** the backend evaluates the expression itself and an offset is given
- **THEN** the offset skips that many matches, and the answer says how far the search went if it stopped early

#### Scenario: Invalid offset
- **WHEN** the offset is negative or not a whole number
- **THEN** the request is refused as `invalid`, and nothing is sent to the context broker

### Requirement: Attributes to return
The entities query SHALL take a list of attribute names and return only those attributes, as the context broker does for the same NGSI-LD query with `attrs`.

#### Scenario: Selected attributes
- **WHEN** a query names attributes to return, on a real context broker
- **THEN** the entities and attributes returned are those the broker returns for the same query with `attrs`

#### Scenario: Short names with a context
- **WHEN** a context address is configured and an attribute is named by a term the context defines
- **THEN** the attribute whose full name matches the term is returned

#### Scenario: With an expression evaluated by the backend
- **WHEN** the backend evaluates the expression itself and attributes are selected
- **THEN** entities are matched on all their attributes, and only the selected attributes are returned

### Requirement: Has-attribute filter
The entities query SHALL take an attribute name and return only entities that have that attribute, each whole.

#### Scenario: Has attribute
- **WHEN** a query asks for entities that have an attribute, on a real context broker
- **THEN** the entities returned are those the broker returns for the same query with `attrs` set to that attribute, each with all its attributes

#### Scenario: With selected attributes
- **WHEN** a query asks for entities that have one attribute and selects others to return
- **THEN** the entities that have the first are returned with the selected attributes

#### Scenario: No entity has it
- **WHEN** no entity has the attribute
- **THEN** the answer is an empty list
