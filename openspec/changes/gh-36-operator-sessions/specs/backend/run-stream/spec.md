# Spec Delta

## ADDED Requirements

### Requirement: Who may open a stream
`/ws/run/{run_id}` and `/api/ngsi/ws` SHALL apply one origin rule, and with sign-in on SHALL need a valid session, before anything is sent.

#### Scenario: A page from another origin
- **WHEN** a page from an origin that isn't the backend's own or in `WS_ALLOWED_ORIGINS` opens either stream, with the operator's cookie
- **THEN** the handshake is refused, and no event is sent

#### Scenario: No session
- **WHEN** a client without a valid session opens either stream
- **THEN** the handshake is refused, and no event is sent

#### Scenario: No origin
- **WHEN** a client without an `Origin` presents a valid session
- **THEN** the stream opens

#### Scenario: Sign-in off
- **WHEN** no identity provider is configured, and a page from another origin opens either stream
- **THEN** the handshake is refused

### Requirement: A stream ends with its session
A stream SHALL close with code `4401` when the session that opened it ends.

#### Scenario: Sign-out, expiry or failed refreshes
- **WHEN** an operator's session ends, for any reason, with streams open
- **THEN** those streams close with `4401`, and no further event reaches them

#### Scenario: Another operator
- **WHEN** another operator's session ends
- **THEN** this operator's streams stay open
