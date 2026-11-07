# Spec Delta

## ADDED Requirements

### Requirement: Alerts routes
The backend SHALL offer alerts, their counts, one alert, actions, environments and services under `/api/alerta`, from the configured Alerta, with its configured key. Callers SHALL NOT be able to name a server or a key.

#### Scenario: List with filters
- **WHEN** alerts are listed with status, severity, environment, service, sort and page
- **THEN** one page of matching alerts without history is returned, with the total and the count per severity for the same filter without the severity filter

#### Scenario: Default order
- **WHEN** alerts are listed without a sort
- **THEN** the most severe come first, then the newest

#### Scenario: Free text
- **WHEN** a search text holds a colon, quotes or regular expression characters
- **THEN** alerts containing that text in their ID, resource, event, text, value or service are returned, and the request does not fail

#### Scenario: Search that stopped early
- **WHEN** a search text is given, and more alerts match the other filters than the backend reads
- **THEN** the answer says so and how many it read, the total and the counts cover only those, and the Alerts screen says this

#### Scenario: Page past the end
- **WHEN** a page after the last is asked for
- **THEN** the answer is successful, with no alerts and the total

#### Scenario: Detail
- **WHEN** one alert is requested
- **THEN** it is returned with its history, oldest first

#### Scenario: Unknown alert
- **WHEN** the alert does not exist, or what is named can't be an alert's ID
- **THEN** the request is refused as `not_found`

### Requirement: Alert actions by operators
The backend SHALL apply the actions `ack`, `unack`, `shelve`, `unshelve`, `close` and `open` with an optional note, and answer with the updated alert.

#### Scenario: Action
- **WHEN** an operator acknowledges an open alert with a note
- **THEN** it is acknowledged, and the answer holds the note in its history

#### Scenario: Action that doesn't fit
- **WHEN** the action doesn't fit the alert's status
- **THEN** the request is refused as `conflict`

#### Scenario: Unknown action
- **WHEN** the action is not one of those listed
- **THEN** the request is refused as `invalid`, and nothing is sent

### Requirement: Alerta address and failures
`ALERTA_URL` SHALL include `/api`. A failing Alerta SHALL give `unavailable` with HTTP 502. The key SHALL be sent as `Authorization: Key <key>`, and SHALL NOT appear in any answer or log.

#### Scenario: Missing /api
- **WHEN** `ALERTA_URL` doesn't end in `/api`
- **THEN** the backend refuses to start, with a message naming the variable and what is missing

#### Scenario: Alerta stopped
- **WHEN** Alerta cannot be reached or answers with a server error
- **THEN** the routes answer HTTP 502, naming Alerta

#### Scenario: Key rejected
- **WHEN** Alerta refuses the key
- **THEN** the routes answer HTTP 502, saying the key was refused, and without the key

#### Scenario: Not an Alerta answer
- **WHEN** the address answers something other than JSON
- **THEN** the routes answer HTTP 502, naming Alerta

### Requirement: Refresh interval
The backend SHALL give the configured refresh interval for alerts.

#### Scenario: Default interval
- **WHEN** an operator hasn't chosen an interval
- **THEN** the Alerts screen uses the configured one
