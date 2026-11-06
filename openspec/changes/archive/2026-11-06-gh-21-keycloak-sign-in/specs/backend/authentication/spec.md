# Spec Delta

## Purpose

Defines how an operator signs in through the identity provider, how the backend keeps the session, and how its token reaches platform services.

## ADDED Requirements

### Requirement: Sign-in is optional
Sign-in SHALL be on only when an identity provider address is configured. When it is off, the backend SHALL work as it does without one, and SHALL report that sign-in is not required.

#### Scenario: Not configured
- **WHEN** no identity provider address is configured
- **THEN** the auth configuration reports sign-in as not enabled, and a sign-in request is refused as `conflict`

### Requirement: Sign-in
An operator SHALL be able to sign in with a username and password, which the backend exchanges for tokens at the identity provider.

#### Scenario: Valid credentials
- **WHEN** an operator signs in with valid credentials
- **THEN** the session is valid, and shows the user, factory and company from the token

#### Scenario: Wrong credentials
- **WHEN** an operator signs in with wrong credentials
- **THEN** the request is refused as `unauthorized` with status 401, and no session exists

#### Scenario: Provider unreachable
- **WHEN** the identity provider cannot be reached
- **THEN** the request is refused as `unavailable` with status 503

#### Scenario: Factory setting
- **WHEN** the token has no factory claim and a factory is configured
- **THEN** the session shows the configured factory

### Requirement: Session stays fresh
The backend SHALL refresh the token 60 seconds before it expires. After 5 failed refreshes in a row, the session SHALL end.

#### Scenario: Beyond the token's life
- **WHEN** the operator stays signed in for longer than a token lasts
- **THEN** the token is replaced and the session stays valid

#### Scenario: A passing failure
- **WHEN** a refresh fails, and a later try succeeds
- **THEN** the session stays valid

#### Scenario: Repeated failures
- **WHEN** 5 refreshes in a row fail
- **THEN** the session is no longer valid, and no token is used

### Requirement: Sign-out
An operator SHALL be able to sign out, which ends the session at the backend and at the identity provider.

#### Scenario: Sign out
- **WHEN** the operator signs out
- **THEN** the session is no longer valid, and the provider has been told to end it

#### Scenario: Provider unreachable at sign-out
- **WHEN** the provider cannot be reached during sign-out
- **THEN** the session still ends at the backend

### Requirement: Token for platform services
Requests to the context broker SHALL carry the session's token when one exists, from the agent, machine name lookups and the health check. Without a session, they SHALL carry no token.

#### Scenario: Broker that requires a token
- **WHEN** an operator is signed in, and a run reads from a broker that requires a token
- **THEN** the broker accepts the requests

#### Scenario: Nobody signed in
- **WHEN** nobody is signed in, and a run reads from a broker that requires a token
- **THEN** the run shows that the source is unavailable, as for any unavailable source

### Requirement: Session after a restart
A session SHALL NOT survive a backend restart. Tokens SHALL be held only in memory.

#### Scenario: Restart
- **WHEN** the backend restarts while an operator is signed in
- **THEN** the session is not valid until the operator signs in again

### Requirement: Credentials stay secret
Passwords and tokens SHALL NOT appear in logs or API responses.

#### Scenario: Full session
- **WHEN** an operator signs in, the token is refreshed and the operator signs out
- **THEN** no response or log line contains the password or a token

### Requirement: Starting what depends on sign-in
The backend SHALL offer a way for other parts to start work after a sign-in, and a failure there SHALL NOT stop the sign-in.

#### Scenario: A dependent part fails
- **WHEN** a part started after sign-in fails
- **THEN** the sign-in still succeeds, and the failure is logged
