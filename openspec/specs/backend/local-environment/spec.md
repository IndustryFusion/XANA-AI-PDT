# backend/local-environment Specification

## Purpose
Lets a developer start the backend with its broker, databases, language model and sample machine data with one command, and connect the operator UI to it during development.

## Requirements

### Requirement: One-command local environment
A contributor SHALL be able to start the backend and all of its dependencies on a developer machine with one documented command, without access to a factory installation or a cloud service.

#### Scenario: First start
- **WHEN** a contributor runs the documented command on a machine with only a container runtime installed
- **THEN** the backend, the memory and time-series database, the context broker and the local language model server start. Once the language model has been downloaded, the health report shows every dependency as `ok`.

#### Scenario: Without a local model
- **WHEN** a contributor starts the local environment with the scripted language model provider
- **THEN** no language model is downloaded, every dependency is reported as `ok`, and the language model check says that its answers are scripted

#### Scenario: Stop and start again
- **WHEN** the contributor stops the environment and starts it again
- **THEN** the memory data, the sample data and the downloaded model are kept

### Requirement: Sample machine data
The local environment SHALL load sample machine data into the context broker and the time-series store. The data includes machines with related components and at least 24 hours of signal history per machine. The machine identifiers are the ones the UI's mock data uses.

#### Scenario: Data present after start
- **WHEN** the local environment has started
- **THEN** the context broker returns the sample machines with their related components, and the time-series store holds their signal history

#### Scenario: Loaded once
- **WHEN** the local environment starts again
- **THEN** the sample data is not duplicated, and changes made to it in the meantime are kept

#### Scenario: Recent history
- **WHEN** the sample data is loaded
- **THEN** the signal history ends at the time of loading, so "recent" queries return data

### Requirement: Frontend connects in development
The frontend development server SHALL forward API and run stream requests to the local backend, so the UI and the backend work together from one address.

#### Scenario: Forwarded requests
- **WHEN** the frontend development server and the local backend are running and the browser requests the backend's health report through the frontend's address
- **THEN** the request is answered by the backend

#### Scenario: Backend address configurable
- **WHEN** the backend runs at a different address and the documented setting names that address
- **THEN** the development server forwards to it

### Requirement: Optional identity provider
The local environment SHALL offer an identity provider on request, with a realm holding the platform's client, claim mappers and a test user. Without the request, it SHALL start without one.

#### Scenario: With the identity provider
- **WHEN** a contributor starts the local environment with its documented authentication profile and address
- **THEN** the UI asks for sign-in, and the test user can sign in

#### Scenario: Without it
- **WHEN** a contributor starts the local environment as usual
- **THEN** no identity provider starts, and the UI opens without sign-in

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

### Requirement: Optional MQTT broker
The local environment SHALL offer an MQTT broker on request, so that changes reach the explorer live. Without the request, it SHALL start without one.

#### Scenario: With the broker
- **WHEN** a contributor starts the local environment with its documented live updates profile, and changes an entity
- **THEN** the change reaches an open explorer

#### Scenario: Without it
- **WHEN** a contributor starts the local environment as usual
- **THEN** no MQTT broker starts, and the explorer says live updates are unavailable

### Requirement: Optional ontology service
The local environment SHALL offer Fuseki on request, loaded with sample shapes and knowledge for the sample machines. Without the request, it SHALL start without one.

#### Scenario: With the service
- **WHEN** a contributor starts the local environment with its documented ontology profile
- **THEN** the value editor shows hints for the sample machines

#### Scenario: Without it
- **WHEN** a contributor starts the local environment as usual
- **THEN** no Fuseki starts, and the value editor works without hints

### Requirement: Optional alert manager
The local environment SHALL offer Alerta on request, with the platform's severities and sample alerts on the sample machines in the form the platform's rules produce. Without the request, it SHALL start without one.

#### Scenario: With the service
- **WHEN** a contributor starts the local environment with its documented alerts profile
- **THEN** the Alerts screen lists the sample alerts, and a run on such a machine shows its alert

#### Scenario: Without it
- **WHEN** a contributor starts the local environment as usual
- **THEN** no Alerta starts, the Alerts screen says it is unavailable, and runs still work

### Requirement: Optional registry stub
The local environment SHALL offer a stub of the registry's routes under a profile.

#### Scenario: Started with the profile
- **WHEN** the environment is started with the profile `ifric`
- **THEN** the routes the backend uses answer as the registry does, for the sample machines

#### Scenario: Without the profile
- **WHEN** the environment is started without it
- **THEN** no stub runs, and the backend reports the registry as not configured

### Requirement: Machine events locally
The local environment SHALL be able to run machine events with real services, and SHALL leave them off unless asked.

#### Scenario: On request
- **WHEN** `EVENT_WEBHOOK_SECRET` and `CALLBACK_BASE_URL` are set
- **THEN** a change on a sample machine starts a run

#### Scenario: Alerts
- **WHEN** the `alerts` profile runs with `XANA_EVENTS_URL` and the secret set
- **THEN** a new alert in Alerta reaches the backend

#### Scenario: A service client
- **WHEN** the `auth` profile runs
- **THEN** the realm has a client with a service account, for development only

#### Scenario: Off by default
- **WHEN** nothing is set
- **THEN** no subscription is made, and Alerta sends nothing
