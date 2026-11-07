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

#### Scenario: Model list
- **WHEN** the operator opens the System area
- **THEN** each model the agent uses is shown with its name, role and whether it is available

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
The System area SHALL show the identity provider, the signed-in user, the session state (active, refreshing, expired) and the time left on the token.

#### Scenario: Session shown
- **WHEN** the operator opens the System area while signed in
- **THEN** the identity provider, user and an active session state are shown

#### Scenario: Token countdown
- **WHEN** the operator opens the System area while signed in
- **THEN** the time left on the token is shown and counts down

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
