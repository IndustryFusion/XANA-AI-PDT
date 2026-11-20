## ADDED Requirements

### Requirement: Expand and collapse all
Every entity in the Data explorer, at the top or expanded in place, SHALL offer to expand all relationship targets below it in place, as the levels load and including those in sub-attributes, each entity once in that tree, and to collapse all below it again. A target folded by hand SHALL stay folded until expanding all is asked for again. Collapsing all SHALL fold sub-attributes, targets in place and raw JSON and history panes, and an entity expanded in place itself.

#### Scenario: Expand all
- **WHEN** the operator expands all relationships of an entity whose targets have relationships of their own
- **THEN** the targets are expanded in place under it, and their targets under them, level by level as they load; every sub-attribute list in that tree is opened, so relationships in sub-attributes are expanded too

#### Scenario: Each entity once
- **WHEN** an entity is reached over several relationships in the tree being expanded
- **THEN** it is expanded at one place only, and its other relationships show it as a line that can be expanded by hand

#### Scenario: Limits of the tree
- **WHEN** a target is already shown above in its branch, lies beyond the nesting limit, or was moved out of the tree
- **THEN** it is not expanded, as when expanding it by hand

#### Scenario: Folded by hand
- **WHEN** the operator folds a target in a tree after expanding all
- **THEN** it stays folded

#### Scenario: Expand all again
- **WHEN** the operator expands all again on an entity whose tree was expanded and partly folded, also on an entity inside a tree being expanded
- **THEN** its tree is expanded again, and entities already shown in it, also those expanded by hand, are not expanded a second time

#### Scenario: Collapse all
- **WHEN** the operator collapses all of an entity at the top whose tree is expanded, with sub-attributes, a raw JSON view or a history pane open
- **THEN** everything below it is folded and those panes are closed, and the entity itself stays open

#### Scenario: Collapse all of an entity expanded in place
- **WHEN** the operator collapses all of an entity that is expanded in place under a relationship
- **THEN** it is folded back into that relationship's line, with everything below it

#### Scenario: Collapse all keeps a moved-out entity's place
- **WHEN** the operator collapses all of an entity from whose tree an entity was moved out, and then re-nests that entity
- **THEN** the entity is shown at its place again

### Requirement: Entities read together
The Data explorer SHALL read the entities, and the latest states of their attributes, that it needs at the same time, such as the next level of a tree, together in one request each rather than one per entity, and a single entity as before.

#### Scenario: A level of a tree
- **WHEN** several entities are expanded at the same time
- **THEN** the explorer asks for them in one request, and for their attributes' latest states in another, and each node shows its own entity, or that it doesn't exist

#### Scenario: One entity
- **WHEN** one entity is opened on its own
- **THEN** it is read on its own, as before

#### Scenario: Reading together fails
- **WHEN** the request for several entities fails as a whole
- **THEN** each of their nodes shows the failure, as for a single entity

#### Scenario: Read anew
- **WHEN** an entity is read again after a change, while an earlier read of it may still be on its way
- **THEN** it is read anew, and the answer to the earlier read is not used for it
