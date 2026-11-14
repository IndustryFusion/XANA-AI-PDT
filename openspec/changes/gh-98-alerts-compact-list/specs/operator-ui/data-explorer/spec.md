## ADDED Requirements

### Requirement: Open at an attribute
A link to an entity in the Data explorer SHALL be able to name an attribute path of that entity: an attribute and the sub-attributes below it, each optionally with a dataset index such as `[0]`. The explorer SHALL expand each level down to the named line, bring that line into view and mark it. Only the entity the link opens SHALL show the mark, and a path the entity doesn't have SHALL open the entity as without a path.

#### Scenario: Link to a sub-attribute
- **WHEN** a link names an entity and the path of an attribute, a sub-attribute of it with a dataset index, and a sub-attribute below that
- **THEN** the attribute and the sub-attribute above the named line are expanded, the named line is in view and marked, and no other line is marked

#### Scenario: Path the entity doesn't have
- **WHEN** a link names an attribute the entity doesn't have
- **THEN** the entity opens as without a path and no line is marked
