## MODIFIED Requirements

### Requirement: Sub-attributes at any depth
The backend SHALL change, add and delete a sub-attribute at any depth, named by its path of attribute names below the entity. Whatever the operator did not change SHALL stay, at every level.

#### Scenario: Change a value at depth
- **WHEN** a sub-attribute of a sub-attribute gets a new value
- **THEN** only that value changes, and the attribute, its other sub-attributes and their sub-attributes stay

#### Scenario: Add at depth
- **WHEN** a sub-attribute is added to a sub-attribute
- **THEN** it is added there, and an existing sub-attribute of that name is refused as `conflict` with nothing changed

#### Scenario: Add to the attribute itself
- **WHEN** a sub-attribute is added to an attribute, named by the attribute and no path, whatever the attribute's kind, a relationship included
- **THEN** it is stored under the attribute as a sub-attribute with its own type and value, the attribute stays one attribute with its value or target, unit and other sub-attributes, and this holds on a broker whose merge stores its own result object; an existing sub-attribute of that name is refused as `conflict` with nothing changed

#### Scenario: Update that brings a new sub-attribute
- **WHEN** an update of an attribute names a sub-attribute the attribute doesn't have yet, with or without a new value
- **THEN** the sub-attribute is stored under the attribute with its own type and value, the value changes if the update gives one, and everything else of the attribute stays, on a broker whose merge stores its own result object too; a new sub-attribute without a type is refused as `invalid` with nothing changed

#### Scenario: Live updates after a write of a whole attribute
- **WHEN** an attribute is written back whole, to add or change a sub-attribute
- **THEN** the backend expects the broker's notification of that change, as for any other edit

#### Scenario: Delete at depth
- **WHEN** a sub-attribute of a sub-attribute is deleted
- **THEN** only it is removed, and with several datasets it is removed from each dataset that has it

#### Scenario: Path that doesn't exist
- **WHEN** a path names a level that doesn't exist
- **THEN** the request is refused as `not_found`, naming the first missing level, and nothing is changed
