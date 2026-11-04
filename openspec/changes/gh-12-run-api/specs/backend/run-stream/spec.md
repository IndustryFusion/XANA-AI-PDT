## ADDED Requirements

### Requirement: Current state first
A client that opens a run's stream SHALL first receive the run's complete current state, and then every step and status change, in the order they happen.

#### Scenario: Join a running run
- **WHEN** a client opens the stream of a run whose observe and hypothesize steps are complete
- **THEN** the first event holds the run with those two steps, and the next events are the validate step, the decide step and the status change

#### Scenario: Status event content
- **WHEN** a run changes status
- **THEN** the status event holds the new status, its state data and the run's summary after the change (including a newly given incident number)

### Requirement: Several watchers
Any number of clients SHALL be able to watch the same run. A slow client SHALL NOT delay the run or the other clients.

#### Scenario: Two clients
- **WHEN** two clients watch the same run
- **THEN** both receive the same events in the same order

#### Scenario: Slow client
- **WHEN** one client stops reading while the run continues
- **THEN** the run and the other client are not delayed. The slow client's stream is closed once its backlog limit is reached, and when it reconnects it receives the current state first.

### Requirement: Unknown runs and liveness
The stream SHALL report an unknown or archived run as an error and then close. While open, it SHALL show that it is alive even when the run is quiet.

#### Scenario: Unknown run
- **WHEN** a client opens the stream of a run identifier that does not exist
- **THEN** it receives an error event with kind `not_found`, and the stream closes

#### Scenario: Quiet run
- **WHEN** a run waits for input for several minutes
- **THEN** the stream stays open and keep-alive messages are exchanged at least every 30 seconds
