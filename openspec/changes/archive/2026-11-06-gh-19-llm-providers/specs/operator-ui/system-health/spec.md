# Spec Delta

## MODIFIED Requirements

### Requirement: Dependency health
The System area SHALL list every dependency with status label, latency, detail and time of the check, show overall health, and allow checking again.

#### Scenario: All healthy
- **WHEN** the operator opens the System area and all dependencies respond
- **THEN** each dependency shows OK with its latency, and overall health is OK

#### Scenario: One dependency down
- **WHEN** one dependency does not respond
- **THEN** it shows an error with the detail, overall health is degraded, and the other dependencies are still shown

#### Scenario: Check again
- **WHEN** the operator chooses to check again
- **THEN** all dependencies are checked anew and the time of the check updates

#### Scenario: Model list
- **WHEN** the operator opens the System area
- **THEN** each model the agent uses is shown with its name, role and whether it is available
