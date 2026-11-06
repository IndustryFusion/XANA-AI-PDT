# Spec Delta

## MODIFIED Requirements

### Requirement: Documented data interface
The UI data interface SHALL be documented per area (session, runs, incidents, entities, alerts, dataspace, system health, and the optional knowledge base), listing each operation, its inputs, the data it returns and its error cases.

#### Scenario: Interface coverage
- **WHEN** the data-interface tests run against the mock data source
- **THEN** every documented operation of the areas implemented so far is exercised, and each returns data matching its documented shape

## ADDED Requirements

### Requirement: Knowledge base area is optional
The data layer SHALL expose the knowledge base area only while the knowledge base is turned on, on every data source.

#### Scenario: Area absent by default
- **WHEN** the UI is built with default settings
- **THEN** the data layer has no knowledge base area on either data source

#### Scenario: Backend build shows no mock documents
- **WHEN** the UI is built with the backend data source and default settings
- **THEN** no screen shows documents from the mock data source
