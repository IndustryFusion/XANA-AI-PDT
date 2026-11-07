# Spec Delta

## ADDED Requirements

### Requirement: Names and the factory from the backend
The backend data source SHALL serve `dataspace.resolveNames`, `dataspace.resolveBuilders` and `session.getFactory` from the backend, leaving out what the registry didn't return.

#### Scenario: Identifiers stay as they are
- **WHEN** names are returned by an identifier holding `_`
- **THEN** the identifier is not changed

#### Scenario: Screens with an empty name
- **WHEN** a name lookup failed
- **THEN** the screen shows the identifier

#### Scenario: Factory without an owner
- **WHEN** the factory has no owner or location
- **THEN** the user pane and Dataspace screen leave them out
