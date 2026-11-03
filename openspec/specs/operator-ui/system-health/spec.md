# operator-ui/system-health Specification

## Purpose
Shows operators and maintainers whether every service the diagnostic system depends on is reachable, and lets them review service settings and the session.

## Requirements

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

### Requirement: Service settings
The System area SHALL show the service addresses in use and let the operator change them, validating addresses before saving and showing which values come from the deployment and which were changed.

#### Scenario: Change an address
- **WHEN** the operator enters a valid address and saves
- **THEN** the setting is saved, marked as changed, and the next health check uses it

#### Scenario: Invalid address
- **WHEN** the operator enters an address that is not a valid URL
- **THEN** saving is refused and the field shows the problem

#### Scenario: Reset to deployment value
- **WHEN** the operator resets a changed setting
- **THEN** the deployment's value is used again

### Requirement: Session state
The System area SHALL show the identity provider, the signed-in user and the session state (active, refreshing, expired).

#### Scenario: Session shown
- **WHEN** the operator opens the System area while signed in
- **THEN** the identity provider, user and an active session state are shown
