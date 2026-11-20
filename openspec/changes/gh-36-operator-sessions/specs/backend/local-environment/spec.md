# Spec Delta

## ADDED Requirements

### Requirement: Sign-in locally over plain HTTP
The local environment SHALL allow a password over plain HTTP explicitly, as all its ports are bound to `127.0.0.1`.

#### Scenario: The auth profile
- **WHEN** the local environment starts with the `auth` profile
- **THEN** an operator can sign in over `http://127.0.0.1`, and the cookie isn't `Secure`
