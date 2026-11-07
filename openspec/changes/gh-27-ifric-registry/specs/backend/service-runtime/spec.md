# Spec Delta

## ADDED Requirements

### Requirement: Registry health
The health report SHALL include an `ifric` check, for which `401` and `403` are failures.

#### Scenario: Works
- **WHEN** the registry answers for the own company with the dataspace token
- **THEN** the check is `ok`

#### Scenario: Refused
- **WHEN** it answers `401` or `403`
- **THEN** the check is `error`, saying that the registry refused the token

#### Scenario: Down
- **WHEN** it can't be reached or fails
- **THEN** the check is `error`

#### Scenario: No token
- **WHEN** the backend isn't connected to the dataspace
- **THEN** the check is `degraded`, saying so

#### Scenario: Not configured
- **WHEN** `IFRIC_URL` is not set
- **THEN** the check is `ok`, saying so, and doesn't count towards the overall state
