# Spec Delta

## ADDED Requirements

### Requirement: Machine events in the health report
The health report SHALL have a `machine_events` check, with the subscription's state in its detail.

#### Scenario: States
- **WHEN** the state is `active`, `waiting_for_identity`, `delivery_failing` or `failed`
- **THEN** the check is `ok`, `degraded`, `degraded` or `error`

#### Scenario: Not configured
- **WHEN** the state is `not_configured`
- **THEN** the check is `ok`, says so, and doesn't count towards the overall result

### Requirement: The new secrets stay secret
`EVENT_WEBHOOK_SECRET`, `KEYCLOAK_SERVICE_CLIENT_SECRET` and the service identity's token SHALL be in no response, log or error message.

#### Scenario: Refused by the broker
- **WHEN** the broker's answer quotes the subscription
- **THEN** neither the log nor the health report holds the secret

#### Scenario: Settings incomplete
- **WHEN** `CALLBACK_BASE_URL` is set without `EVENT_WEBHOOK_SECRET`, or only one of the service client's two settings is set
- **THEN** the backend stops, with a message naming the variable, never a value
