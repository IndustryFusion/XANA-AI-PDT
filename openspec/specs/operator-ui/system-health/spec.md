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

### Requirement: Allowed contexts
The System area SHALL list the contexts an imported entity may name, each with its source (NGSI-LD core, built in, deployment, added here), and SHALL let the operator add a context and remove one added here, after confirming. Before a context is added, it SHALL say that the broker fetches it from inside the platform and that its owner decides what names mean, and SHALL name the risks the backend reports for that address.

#### Scenario: The list
- **WHEN** the operator opens the System area
- **THEN** the allowed contexts are listed with their source, and only those added here offer *Remove…*

#### Scenario: Adding warns first
- **WHEN** the operator enters `http://contexts.example.net/c.jsonld` and chooses *Allow…*
- **THEN** a dialog states what allowing a context means and that this one is plain http, and offers *Allow anyway*; confirming lists it as added here

#### Scenario: No further risk
- **WHEN** the address has no risk beyond its owner
- **THEN** the dialog states what allowing a context means, and offers *Allow*

#### Scenario: No URL
- **WHEN** the operator chooses *Allow…* without a URL
- **THEN** the field asks for the context's URL

#### Scenario: Removing
- **WHEN** the operator removes a context added here, and confirms
- **THEN** it is no longer listed, and the dialog has said that entities already in the broker stay

#### Scenario: Not editable
- **WHEN** the backend can't add contexts
- **THEN** the list is shown without a way to add, and says why
