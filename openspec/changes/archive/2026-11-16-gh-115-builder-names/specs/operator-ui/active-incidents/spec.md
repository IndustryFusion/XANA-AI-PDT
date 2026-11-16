## MODIFIED Requirements

### Requirement: Machine builder per row
Each row SHALL name its machine builder: for an escalated run, the builder it was escalated to, by name, else the registry's name for the machine's builder, else its ID; for any other run, the registry's name for the machine's builder, when the registry knows one. The list SHALL look up the builders of its machines in one request, and SHALL show no builder from the registry before its first answer or when it fails, keeping those already known while a new lookup loads.

#### Scenario: Escalated run
- **WHEN** a listed run has been escalated
- **THEN** its row names the machine builder it was escalated to, or its ID when no name is known

#### Scenario: Not escalated, builder known
- **WHEN** a listed run has not been escalated and the registry names its machine's builder
- **THEN** its row names that builder

#### Scenario: Not escalated
- **WHEN** a listed run has not been escalated and the registry knows no builder for its machine, or can't be reached
- **THEN** its row shows no machine builder, and the list works as before

#### Scenario: One lookup
- **WHEN** the list shows several runs
- **THEN** the builders of their machines are looked up in one request

#### Scenario: Another run in the list
- **WHEN** a run on another machine joins the list
- **THEN** the rows keep the builders already known while the new lookup loads

#### Scenario: Recovery
- **WHEN** the registry could not be reached, and answers when the list is opened again
- **THEN** the rows of runs that were not escalated name the builders it knows
