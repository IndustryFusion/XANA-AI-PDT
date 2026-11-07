# Spec Delta

## ADDED Requirements

### Requirement: Encryption key for the gateway
A backend with `GATEWAY_URL` SHALL have a valid `SETTINGS_ENCRYPTION_KEY`.

#### Scenario: Missing key
- **WHEN** the backend starts with `GATEWAY_URL` and no key
- **THEN** it stops with a message naming `SETTINGS_ENCRYPTION_KEY` and how to make one

#### Scenario: Invalid key
- **WHEN** the key is not a valid key
- **THEN** it stops with a message naming the variable, never its value

#### Scenario: No gateway
- **WHEN** the backend starts without `GATEWAY_URL`
- **THEN** it needs no key

#### Scenario: Secrets are masked
- **WHEN** the secret or the key would appear in a log
- **THEN** it is masked

### Requirement: Dataspace health
The health report SHALL include `gateway` and `connector` checks.

#### Scenario: Gateway up
- **WHEN** the gateway answers its health route and the token is accepted
- **THEN** both checks are `ok`, and the connector's detail says how far it could check

#### Scenario: Gateway down
- **WHEN** the gateway can't be reached
- **THEN** `gateway` is `error`

#### Scenario: Not connected
- **WHEN** the gateway is up and there is no valid token
- **THEN** `gateway` is `ok`, and `connector` is `degraded`, saying that the backend is not connected

#### Scenario: Adapter failing
- **WHEN** the gateway is up and an authenticated read answers `503`
- **THEN** `connector` is `error`

#### Scenario: Dataspace not configured
- **WHEN** no gateway is configured
- **THEN** both are `ok`, saying so, and the overall state is unchanged
