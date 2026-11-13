## ADDED Requirements

### Requirement: Declared values
The backend SHALL read a property value returned as a value object -- `@value` with its datatype as `type` or `@type` -- as that `@value`, and a number written as a string inside a value object of a numeric datatype as that number. Query conditions it evaluates itself SHALL compare against that value. It SHALL NOT depend on which form the broker returns for an attribute.

#### Scenario: Range on a declared double
- **WHEN** an entity's `temperature` is `{"type": "http://www.w3.org/2001/XMLSchema#double", "@value": 42.5}` and the query has `temperature==40..50` or `temperature>40`, evaluated by the backend
- **THEN** the entity matches

#### Scenario: Declared number written as a string
- **WHEN** the `temperature` is `{"type": "http://www.w3.org/2001/XMLSchema#double", "@value": "42.5"}` and the query has `temperature>40`, evaluated by the backend
- **THEN** the entity matches

#### Scenario: Plain values unchanged
- **WHEN** the `temperature` is the plain number `42.5`
- **THEN** the query behaves as before

### Requirement: Edits of declared values
A declared number SHALL count as a number when an edit is checked, and an edit of a declared value SHALL send the new value declared with the stored datatype.

#### Scenario: Text for a declared number
- **WHEN** the operator sets a `temperature` stored as a declared double to `hot`
- **THEN** the change is refused as not a number, and the broker is not called

#### Scenario: A number for a declared number
- **WHEN** the operator sets that `temperature` to `80`
- **THEN** the backend sends `{"@value": 80, "@type": "http://www.w3.org/2001/XMLSchema#double"}`, and reading the entity back gives 80

#### Scenario: A plain number edited
- **WHEN** the operator edits a `temperature` stored as the plain number `42.5`
- **THEN** the edit behaves as before
