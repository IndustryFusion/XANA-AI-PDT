## MODIFIED Requirements

### Requirement: Value hints from the backend
The backend data source SHALL serve `getValueHints` and `getUnits` from the backend, with their results in the documented shapes.

#### Scenario: Hints
- **WHEN** a screen asks for hints of an attribute
- **THEN** it receives the kind of hint, the allowed values and the limits, and the units the data model allows

#### Scenario: Units
- **WHEN** a screen asks for the units to offer
- **THEN** it receives them with code, symbol and name, and where they come from
