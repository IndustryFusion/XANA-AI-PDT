# Spec Delta

## ADDED Requirements

### Requirement: Settings on a backend are read-only
On the backend source, the service settings SHALL show the addresses in use, and offer nothing to change.

#### Scenario: Shown
- **WHEN** the System area opens on a backend build
- **THEN** the addresses are listed, with no field or button to change them, and it says that they are set at deployment

#### Scenario: A save anyway
- **WHEN** `saveServiceSettings` is called on the backend source
- **THEN** it is refused as `conflict`, and nothing is sent to the backend

### Requirement: What a check looked at
The health table SHALL show each check's probe and hint, when it has them.

#### Scenario: A failing check
- **WHEN** a check has failed
- **THEN** the table shows where it looked, and what to look at
