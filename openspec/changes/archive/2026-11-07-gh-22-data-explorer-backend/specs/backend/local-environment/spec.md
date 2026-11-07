# Spec Delta

## ADDED Requirements

### Requirement: Optional history service
The local environment SHALL offer PostgREST on request, on the sample history, in the platform's table layout. Without the request, it SHALL start without one, and everything except the explorer's history and time-shift SHALL work.

#### Scenario: With the service
- **WHEN** a contributor starts the local environment with its documented history profile
- **THEN** history and time-shift work in the explorer

#### Scenario: Without it
- **WHEN** a contributor starts the local environment as usual
- **THEN** no PostgREST starts, and history and time-shift say the service is unavailable

#### Scenario: Existing data
- **WHEN** the environment starts with a database from before this change
- **THEN** the tables gain the missing columns, and the sample data stays

#### Scenario: Token accepted
- **WHEN** the history profile runs with the authentication profile
- **THEN** a signed-in operator's token is accepted, with no anonymous access needed
