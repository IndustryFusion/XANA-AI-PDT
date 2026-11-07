# Spec Delta

## ADDED Requirements

### Requirement: A session per browser
Each sign-in SHALL create a session of its own, with its own tokens and refresh, and its reference SHALL be a random value in a cookie that scripts can't read.

#### Scenario: Two operators
- **WHEN** two operators sign in from two browsers
- **THEN** each sees their own name and time left, in `/api/auth/status`

#### Scenario: One signs out
- **WHEN** one of them signs out
- **THEN** that session has ended, here and at the provider, and the other is still valid

#### Scenario: One's refresh fails
- **WHEN** 5 refreshes of one session fail in a row
- **THEN** that session ends, and the other stays valid

#### Scenario: The cookie
- **WHEN** an operator signs in
- **THEN** the answer sets a new reference with `HttpOnly`, `SameSite=Lax` and `Path=/`, and `Secure` unless plain HTTP is allowed, and the answer's body holds neither the reference nor a token

#### Scenario: An old reference
- **WHEN** a request presents a reference that has ended, or was never given
- **THEN** it is treated as having no session

#### Scenario: Too many
- **WHEN** a sign-in would pass the limit on sessions
- **THEN** the oldest session ends

#### Scenario: A long session
- **WHEN** a session is 8 hours old
- **THEN** it ends, whatever its tokens

### Requirement: Sessions and a restart
Sessions SHALL be held only in memory, and a restart SHALL end them all.

#### Scenario: Restart
- **WHEN** the backend restarts with operators signed in
- **THEN** their next request is treated as having no session, and the UI shows the sign-in screen

### Requirement: Tokens stay on the server
Tokens and session references SHALL NOT appear in logs, or in answers beyond the one cookie.

#### Scenario: A full session with two operators
- **WHEN** two operators sign in, tokens are refreshed, runs start, and they sign out
- **THEN** no log line and no answer holds a password, token or reference, other than the cookie itself
