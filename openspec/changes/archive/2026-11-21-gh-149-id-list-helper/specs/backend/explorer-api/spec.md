# Delta for Explorer API

## ADDED Requirements

### Requirement: Entities read by a list of IDs
Every read of entities by a list of IDs (the endpoints for many entities, the has-attribute filter's second read, the read before an import) SHALL query the broker for up to 100 IDs, read an ID with a comma and the IDs of a list too long for its address on their own, and without further parameters also those of a list it refuses, leaving out what it can't read; a failing broker SHALL fail the read.

#### Scenario: An existing ID with a comma in an import
- **WHEN** an entity whose ID contains a comma is imported while it exists
- **THEN** it is reported as `updated`

#### Scenario: An import whose list the broker refuses
- **WHEN** the broker refuses the list of the imported IDs
- **THEN** each is read on its own, and the existing ones are reported as `updated`, the others as `created`

#### Scenario: An import the broker refuses to read
- **WHEN** the broker refuses the list of the imported IDs and the read of one of them on its own
- **THEN** the import is refused, and nothing is written, as an ID the broker refuses is not taken for an absent one

#### Scenario: The has-attribute filter with an ID with a comma
- **WHEN** an entity whose ID contains a comma has the attribute asked for
- **THEN** it is returned whole, as the others

#### Scenario: The has-attribute filter with a list the broker refuses
- **WHEN** the broker refuses the list of the IDs found as invalid
- **THEN** the request is refused as invalid, as before, since the refusal can't be told from one of its parameters

#### Scenario: The has-attribute filter with a list too long
- **WHEN** the list of the IDs found is too long for the broker's address
- **THEN** each is read on its own, and the entities are returned whole

#### Scenario: Parameters the broker refuses
- **WHEN** the has-attribute filter asks for attributes the broker refuses, also for an ID with a comma read on its own
- **THEN** the request is refused as invalid, as before, and not answered as an empty list

#### Scenario: A single read failing
- **WHEN** the broker fails a read of one of the IDs read on their own, or answers it with no entity
- **THEN** the read fails, as a read of that entity alone does
