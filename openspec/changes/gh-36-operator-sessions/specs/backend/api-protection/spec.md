# Spec Delta

## ADDED Requirements

### Requirement: Routes need a session
With sign-in on, every route SHALL refuse a request without a valid session, as `unauthorized`, apart from `/healthz`, `/api/auth/config`, `/api/auth/connect`, `/api/auth/status` and `/events/*`.

#### Scenario: No session
- **WHEN** a request without a session reaches any protected route
- **THEN** it is refused with 401, and nothing happens

#### Scenario: Every route is covered
- **WHEN** a new route is added to the app, and isn't on the list above
- **THEN** it is protected without further ado, and a test walking every route shows it

#### Scenario: What stays open
- **WHEN** a request without a session reaches a route on the list
- **THEN** it is answered as today, and `/events/*` by their own secret

#### Scenario: Sign-in off
- **WHEN** no identity provider is configured
- **THEN** no route needs a session

### Requirement: Requests from other pages
A request that changes something SHALL be refused when its `Origin` isn't the backend's own or allowed, with or without a session.

#### Scenario: Another page
- **WHEN** a page from another origin sends a `POST`, with the operator's cookie
- **THEN** it is refused, and nothing happens

#### Scenario: Not a web page
- **WHEN** a request has no `Origin`
- **THEN** only the session decides

### Requirement: Platform calls carry the caller's token
Calls to platform services on behalf of a route SHALL carry the token of the session that made the request.

#### Scenario: Two at once
- **WHEN** two operators' requests reach the explorer at the same time
- **THEN** each call to the broker carries the token of the session that made it

### Requirement: Passwords over plain HTTP
The backend SHALL refuse a password that didn't come over TLS, unless plain HTTP is explicitly allowed.

#### Scenario: Plain HTTP
- **WHEN** a sign-in arrives over plain HTTP, and it isn't allowed
- **THEN** it is refused as `invalid`, saying why, and the provider isn't asked

#### Scenario: Behind a trusted proxy
- **WHEN** a trusted proxy says the request came over TLS
- **THEN** it is accepted

#### Scenario: A header from anyone else
- **WHEN** a client not trusted as a proxy says the same
- **THEN** it is treated as plain HTTP
