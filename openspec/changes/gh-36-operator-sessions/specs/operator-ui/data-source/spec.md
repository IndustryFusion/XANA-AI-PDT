# Spec Delta

## ADDED Requirements

### Requirement: Backend source with sessions
The backend source SHALL send the session cookie on every call and stream, and SHALL treat a lost session in one way.

#### Scenario: Lost session on a call
- **WHEN** any area's call is refused as `unauthorized`, other than a sign-in with a wrong password
- **THEN** the session gate reads the session again, and shows the sign-in screen

#### Scenario: Lost session on a stream
- **WHEN** a stream closes with `4401`, or can't open and the session isn't valid
- **THEN** the stream ends without further tries, and the sign-in screen shows

#### Scenario: Another operator signs out
- **WHEN** another browser's operator signs out
- **THEN** nothing changes in this one

#### Scenario: Password over plain HTTP
- **WHEN** the page is plain HTTP, and the backend says that a password would be refused
- **THEN** the sign-in screen says so, and shows no password form
