## ADDED Requirements

### Requirement: Referring entities
The backend SHALL offer, for an entity ID, the entities that refer to it in ID order, each with its ID, type, name if it has one, and the places it refers from: the attribute and the sub-attributes below it, and the dataset of the attribute's instance. It SHALL find relationships and properties holding the ID at any depth. A search SHALL stop after a bounded number of entities, saying how many it searched.

#### Scenario: Kinds of references
- **WHEN** entities hold the ID as the object of a relationship, as one of several objects, in a list of relationships, as a property's IRI and as a property's text
- **THEN** each of them is answered as a place

#### Scenario: Full names
- **WHEN** an entity refers by an attribute named by an IRI that holds dots
- **THEN** it is found, and the place has the name unchanged

#### Scenario: Sub-attributes and datasets
- **WHEN** an entity refers in a sub-attribute of one instance of an attribute
- **THEN** the place is the path of names down to it, with that instance's dataset

#### Scenario: No reference
- **WHEN** an entity holds the ID only inside a JSON value, or an ID that merely begins with it
- **THEN** it is not answered

#### Scenario: Nothing refers
- **WHEN** no entity refers to the ID, whether or not an entity has it
- **THEN** the answer is an empty list

#### Scenario: Many entities
- **WHEN** a referring entity is beyond the first page of the broker's entities
- **THEN** it is found

#### Scenario: Stopped early
- **WHEN** there are more entities than a search reads, or very many referring entities
- **THEN** the answer says how many entities were searched, and the total if the broker gave it

#### Scenario: Invalid ID
- **WHEN** the ID is empty, `.` or `..`
- **THEN** it is refused as invalid, and the broker is not asked

#### Scenario: Failing broker
- **WHEN** the broker fails or its answer is no list of entities
- **THEN** the search fails as the other reads do, and a later search answers again once the broker does
