# Spec Delta

## ADDED Requirements

### Requirement: No document retrieval while the knowledge base is off
Simulated runs SHALL show no document retrieval step and cite no manuals while the knowledge base is off. Similar-incident lookup from agent memory SHALL still be shown.

#### Scenario: Default build
- **WHEN** a simulated run progresses on a default build
- **THEN** its steps include no document retrieval and no manuals, and it still reaches its documented end

#### Scenario: Memory lookup stays
- **WHEN** a simulated run looks up similar incidents
- **THEN** that step is shown as before
