# Spec Delta

## ADDED Requirements

### Requirement: The builder's current access when approving
The approval panel for a data request SHALL show what the machine builder may access at this factory, read from the gateway when the panel opens and on request.

#### Scenario: Current access
- **WHEN** the operator opens the approval panel, on a real gateway
- **THEN** each capability the builder may access here is shown with its status as the gateway has it at that moment

#### Scenario: Changed meanwhile
- **WHEN** the builder's access changes at the gateway while the panel is open, and the operator refreshes it
- **THEN** the panel shows the new status

#### Scenario: Read fails
- **WHEN** the access can't be read
- **THEN** the panel says so, and approving and denying still work
