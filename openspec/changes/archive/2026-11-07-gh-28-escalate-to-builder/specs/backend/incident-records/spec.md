# Spec Delta

## ADDED Requirements

### Requirement: Escalation in the record
An archived incident SHALL record the builder, the conversation reference and the outcome.

#### Scenario: Archived after escalating
- **WHEN** an escalated run is stopped and archived
- **THEN** its record says it was escalated, with the reference, the builder's name, the escalation and the outcome, and a summary in the list says the same

#### Scenario: Not escalated
- **WHEN** a run that wasn't escalated is archived
- **THEN** these are empty, as before
