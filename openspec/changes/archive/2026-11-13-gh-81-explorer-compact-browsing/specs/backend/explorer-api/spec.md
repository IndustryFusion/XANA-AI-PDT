# Spec Delta

## ADDED Requirements

### Requirement: Prefixes of the configured context
The backend SHALL offer the prefixes the configured JSON-LD context defines, each with its namespace, read from the configured context only. Without a configured context the list SHALL be empty. A context that can't be read SHALL give an empty list with the reason, not an error.

#### Scenario: Context with prefixes
- **WHEN** the configured context defines terms whose values are namespaces ending in `/` or `#`
- **THEN** the answer lists each such term as a prefix with its namespace, and no other term

#### Scenario: No context configured
- **WHEN** no context is configured
- **THEN** the answer is an empty list

#### Scenario: Context can't be read
- **WHEN** the configured context can't be fetched or is not valid JSON-LD
- **THEN** the answer is an empty list with a reason that names neither an address nor a token, and the other explorer routes keep working

#### Scenario: Caller names a context
- **WHEN** a caller adds a context address to the request
- **THEN** only the configured context is read

#### Scenario: Read once
- **WHEN** prefixes are asked for repeatedly
- **THEN** the context is fetched again at most once per ten minutes

### Requirement: Sub-attributes at any depth
The backend SHALL change, add and delete a sub-attribute at any depth, named by its path of attribute names below the entity. Whatever the operator did not change SHALL stay, at every level.

#### Scenario: Change a value at depth
- **WHEN** a sub-attribute of a sub-attribute gets a new value
- **THEN** only that value changes, and the attribute, its other sub-attributes and their sub-attributes stay

#### Scenario: Add at depth
- **WHEN** a sub-attribute is added to a sub-attribute
- **THEN** it is added there, and an existing sub-attribute of that name is refused as `conflict` with nothing changed

#### Scenario: Delete at depth
- **WHEN** a sub-attribute of a sub-attribute is deleted
- **THEN** only it is removed, and with several datasets it is removed from each dataset that has it

#### Scenario: Path that doesn't exist
- **WHEN** a path names a level that doesn't exist
- **THEN** the request is refused as `not_found`, naming the first missing level, and nothing is changed

### Requirement: History of sub-attributes
The backend SHALL read a sub-attribute's values over a time range from the time-series store, named by its path of attribute names below the entity, in the same way as an attribute's.

#### Scenario: Sub-attribute values
- **WHEN** the history of a sub-attribute is requested by its path
- **THEN** only the values recorded for that sub-attribute under that parent are returned, oldest first

#### Scenario: Same name under another parent
- **WHEN** two attributes of an entity each have a sub-attribute of the same name
- **THEN** the history of one holds none of the other's values

#### Scenario: Top-level attribute unchanged
- **WHEN** the history of an attribute is requested without a path
- **THEN** the answer is the same as before this change, and holds no sub-attribute values
