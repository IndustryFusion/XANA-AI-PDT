# Spec Delta

## ADDED Requirements

### Requirement: Value hints from the backend
The backend data source SHALL serve `getValueHints` from the backend, with its result in the documented shape.

#### Scenario: Hints
- **WHEN** a screen asks for hints of an attribute
- **THEN** it receives the kind of hint, the allowed values and the limits
