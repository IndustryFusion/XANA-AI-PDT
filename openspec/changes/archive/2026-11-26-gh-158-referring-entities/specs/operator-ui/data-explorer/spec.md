## ADDED Requirements

### Requirement: Referring entities
Every entity in the Data explorer, at the top or expanded in place, SHALL offer to show the entities that refer to it, each with its type, name and ID and the attributes it refers from, apart from the entity's own attributes. A referring entity SHALL expand in place like a relationship target, offering its own list, and each attribute SHALL open the referring entity at that attribute. The list SHALL NOT be offered at a past moment.

#### Scenario: What refers to an entity
- **WHEN** the operator asks for what refers to an entity
- **THEN** the referring entities are listed with the number of them, and each with the attribute, sub-attribute and dataset it refers from, as short names

#### Scenario: Opened at the attribute
- **WHEN** the operator follows an attribute in the list
- **THEN** the referring entity is opened with that attribute's line marked

#### Scenario: Further up
- **WHEN** the operator expands a referring entity in place
- **THEN** it is shown as an entity expanded in place, and offers what refers to it in turn

#### Scenario: Limits of the way up
- **WHEN** a referring entity is already shown above in its branch, or lies beyond the nesting limit
- **THEN** it is marked as such instead of being expandable, also an entity that refers to itself

#### Scenario: Moved out and back
- **WHEN** the operator unnests a referring entity expanded in place, and re-nests it
- **THEN** its line leads to it while it is moved out, and it is shown in the list again after

#### Scenario: Expanding all goes down only
- **WHEN** the operator expands all relationships of an entity in whose list a referring entity is expanded
- **THEN** the entity's own relationships are expanded, and nothing in the referring entity is

#### Scenario: Collapsing all
- **WHEN** the operator collapses all of an entity whose list is shown
- **THEN** the list is closed

#### Scenario: A folded entity
- **WHEN** the operator asks for what refers to a folded entity
- **THEN** the entity is opened with the list

#### Scenario: Nothing refers
- **WHEN** no entity refers to the entity
- **THEN** the list says so

#### Scenario: Stopped early
- **WHEN** the search did not cover all entities
- **THEN** the list says how many were searched, and that there may be more

#### Scenario: Failed search
- **WHEN** the search fails
- **THEN** the list says so with the reason and offers to try again, the entity stays usable, and the referring entities are listed once a try succeeds

#### Scenario: The past
- **WHEN** the explorer shows a past moment
- **THEN** the action is not offered
