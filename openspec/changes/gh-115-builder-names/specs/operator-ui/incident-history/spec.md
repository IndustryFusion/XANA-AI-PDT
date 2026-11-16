## ADDED Requirements

### Requirement: Machine builder per incident
Each past incident in the list SHALL name its machine's builder as the registry knows it. The list SHALL look up the builders of all its machines in one request, whatever the filters, and SHALL show no builder before its first answer, when it fails, or for a machine the registry knows no builder of.

#### Scenario: Builder known
- **WHEN** the registry names the builder of a listed incident's machine
- **THEN** the incident's row names that builder

#### Scenario: Builder unknown
- **WHEN** the registry knows no builder for a listed incident's machine, or can't be reached
- **THEN** the row shows no machine builder, and the list works as before

#### Scenario: Recovery
- **WHEN** the registry could not be reached, and answers when the list is opened again
- **THEN** the rows name the builders it knows

#### Scenario: One lookup
- **WHEN** the list shows several incidents
- **THEN** the builders of their machines are looked up in one request

#### Scenario: Filters changed
- **WHEN** the operator changes a filter of the list
- **THEN** the rows keep their builders, and the registry is not asked again
