# Spec Delta

## ADDED Requirements

### Requirement: Machine events locally
The local environment SHALL be able to run machine events with real services, and SHALL leave them off unless asked.

#### Scenario: On request
- **WHEN** `EVENT_WEBHOOK_SECRET` and `CALLBACK_BASE_URL` are set
- **THEN** a change on a sample machine starts a run

#### Scenario: Alerts
- **WHEN** the `alerts` profile runs with `XANA_EVENTS_URL` and the secret set
- **THEN** a new alert in Alerta reaches the backend

#### Scenario: A service client
- **WHEN** the `auth` profile runs
- **THEN** the realm has a client with a service account, for development only

#### Scenario: Off by default
- **WHEN** nothing is set
- **THEN** no subscription is made, and Alerta sends nothing
