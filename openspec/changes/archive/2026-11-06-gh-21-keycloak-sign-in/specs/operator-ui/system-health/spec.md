# Spec Delta

## MODIFIED Requirements

### Requirement: Session state
The System area SHALL show the identity provider, the signed-in user, the session state (active, refreshing, expired) and the time left on the token.

#### Scenario: Session shown
- **WHEN** the operator opens the System area while signed in
- **THEN** the identity provider, user and an active session state are shown

#### Scenario: Token countdown
- **WHEN** the operator opens the System area while signed in
- **THEN** the time left on the token is shown and counts down
