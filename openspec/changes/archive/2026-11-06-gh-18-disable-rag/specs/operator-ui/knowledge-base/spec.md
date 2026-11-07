# Spec Delta

## ADDED Requirements

### Requirement: Off by default
The knowledge base SHALL be off by default and SHALL be turned on by one documented build setting. The other requirements of this capability SHALL apply only while it is on.

#### Scenario: Default build
- **WHEN** the UI is built with default settings
- **THEN** no knowledge base screen, navigation entry or status is shown

#### Scenario: Turned on
- **WHEN** the UI is built with the documented setting turned on
- **THEN** the knowledge base screen is available and meets the other requirements of this capability
