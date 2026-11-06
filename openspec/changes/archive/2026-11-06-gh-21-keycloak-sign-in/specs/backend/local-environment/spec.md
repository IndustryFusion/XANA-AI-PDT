# Spec Delta

## ADDED Requirements

### Requirement: Optional identity provider
The local environment SHALL offer an identity provider on request, with a realm holding the platform's client, claim mappers and a test user. Without the request, it SHALL start without one.

#### Scenario: With the identity provider
- **WHEN** a contributor starts the local environment with its documented authentication profile and address
- **THEN** the UI asks for sign-in, and the test user can sign in

#### Scenario: Without it
- **WHEN** a contributor starts the local environment as usual
- **THEN** no identity provider starts, and the UI opens without sign-in
