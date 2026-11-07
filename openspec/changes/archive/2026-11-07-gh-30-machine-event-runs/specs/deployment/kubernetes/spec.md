# Spec Delta

## ADDED Requirements

### Requirement: Machine events settings
The chart SHALL pass the machine events' settings, with the secrets kept apart from the ConfigMap.

#### Scenario: Secrets
- **WHEN** `EVENT_WEBHOOK_SECRET` or `KEYCLOAK_SERVICE_CLIENT_SECRET` is supplied
- **THEN** it is in a Secret, and in no ConfigMap

#### Scenario: Address
- **WHEN** `callbackBaseUrl` is set
- **THEN** the backend receives it as `CALLBACK_BASE_URL`, and with it unset no subscription is made
