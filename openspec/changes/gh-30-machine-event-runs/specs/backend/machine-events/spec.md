# Spec Delta

## ADDED Requirements

### Requirement: Authenticated webhooks
`POST /events/ngsi` and `POST /events/alert` SHALL accept only callers presenting the configured secret as a bearer token.

#### Scenario: No secret, or a wrong one
- **WHEN** a call has no `Authorization` header, or another secret
- **THEN** it is refused as `unauthorized` with 401, its body isn't read, and nothing is queued

#### Scenario: None configured
- **WHEN** no `EVENT_WEBHOOK_SECRET` is configured
- **THEN** every call is refused as `unauthorized`

#### Scenario: Accepted
- **WHEN** a call presents the secret
- **THEN** it is answered 202 with `{accepted, ignored}` before any run starts

#### Scenario: Queue full
- **WHEN** the queue is full
- **THEN** the call is answered 503, and says so

### Requirement: Events from the context broker
The backend SHALL read each entity of a notification as an event for that machine, with an issue naming the watched values, whether attributes have short names or full IRIs.

#### Scenario: A status change
- **WHEN** a notification reports a machine's `status` with a value not seen before
- **THEN** one run starts for that machine, with an issue naming the value

#### Scenario: A machine not seen before
- **WHEN** the first notification for a machine arrives, whatever its values
- **THEN** one run starts

#### Scenario: The same values again
- **WHEN** a notification repeats the watched values last seen for the machine, also after a restart
- **THEN** no run starts

#### Scenario: Full IRIs
- **WHEN** the attributes are full IRIs ending in a watched name
- **THEN** they are read as that name

#### Scenario: Not usable
- **WHEN** a notification's body isn't JSON, or has no `data` list
- **THEN** it is refused as `invalid`, and an entity without an ID is counted as ignored

### Requirement: Events from alerts
The backend SHALL read an Alerta alert, or `{machine_id, issue}`, as an event for that machine.

#### Scenario: A new alert
- **WHEN** a new alert arrives for a machine, with a severity showing a problem
- **THEN** one run starts for its `resource`, with an issue naming its event and text

#### Scenario: Nothing to diagnose
- **WHEN** the alert is a repeat, its severity is `ok`, `normal`, `up`, `cleared`, `informational`, `debug` or `trace`, or its status is `closed`, `expired`, `shelved` or `blackout`
- **THEN** it is counted as ignored, and no run starts

#### Scenario: Plain form
- **WHEN** the body is `{machine_id, issue}`
- **THEN** one run starts for that machine

#### Scenario: Neither form
- **WHEN** the body names no machine
- **THEN** it is refused as `invalid`

### Requirement: One worker, one open run per machine
One worker SHALL handle events in order, and an event for a machine with an open run SHALL start nothing.

#### Scenario: Repeated events during a run
- **WHEN** events for a machine arrive while its run is `running`, also at the same moment
- **THEN** exactly one run exists for it

#### Scenario: While paused
- **WHEN** events arrive while the machine's run waits for the operator or the machine builder
- **THEN** no run starts

#### Scenario: After the run ended
- **WHEN** the run is `completed`, `failed`, `stopped` or `mb_closed`, and the watched values change
- **THEN** a new run starts

#### Scenario: After a restart
- **WHEN** the backend restarts with an open run, and an event for that machine arrives
- **THEN** no run starts

#### Scenario: An operator is starting a run
- **WHEN** an event arrives while an operator's start for that machine is being stored
- **THEN** only the operator's run exists

#### Scenario: Other machines aren't held up
- **WHEN** a run of one machine is in progress, and an event for another arrives
- **THEN** a run starts for the other at once

### Requirement: Events survive what can fail
The worker SHALL go on after any failure, and lose no event while the process lives and the memory database is down.

#### Scenario: Memory database down
- **WHEN** the memory database can't be reached during an event
- **THEN** the worker tries again until it can, and one run starts

#### Scenario: Language model down
- **WHEN** the language model isn't available
- **THEN** the run starts, and fails visibly with its source

#### Scenario: Unknown name
- **WHEN** an event names a machine that can't be resolved
- **THEN** it is logged and dropped, and the next event is handled

#### Scenario: Something unexpected
- **WHEN** handling an event raises anything else
- **THEN** it is logged, and the next event is handled

### Requirement: The subscription
The backend SHALL keep one subscription with the ID `urn:ngsi-ld:Subscription:XanaPDT:MachineWatch`, by default on type `Machine`, watching `status`, `errorCode`, `alarmLevel` and `faultCode`, delivered to `{CALLBACK_BASE_URL}/events/ngsi` with the secret, under `NGSI_CONTEXT_URL` or else the core context.

#### Scenario: Data with full IRIs
- **WHEN** `MACHINE_WATCH_TYPE` and `MACHINE_WATCH_ATTRIBUTES` name the platform's type and attributes, in short names or full IRIs
- **THEN** a change of a watched attribute on such data notifies, and is read by the last part of its name

#### Scenario: No identity yet
- **WHEN** sign-in is on, and neither a service identity nor a signed-in operator has a token
- **THEN** no subscription is created, the state says so, and it is tried again

#### Scenario: Identity becomes available
- **WHEN** a token becomes available
- **THEN** the subscription is created at the next try, and the state is `active`

#### Scenario: Sign-in off
- **WHEN** sign-in is off
- **THEN** the subscription is created without a token

#### Scenario: A restart
- **WHEN** the backend starts and the subscription exists
- **THEN** it is updated, not created again, so one exists, with the current address and secret

#### Scenario: Removed
- **WHEN** the subscription disappears from the broker
- **THEN** it is created again

#### Scenario: Refused
- **WHEN** the broker refuses, including with 401 or 403
- **THEN** the state is `failed`, says why without a secret, and it is tried again

#### Scenario: Not delivered
- **WHEN** the broker reports `notification.status` as `failed`
- **THEN** the state is `delivery_failing`

#### Scenario: Not configured
- **WHEN** `CALLBACK_BASE_URL` isn't set
- **THEN** no subscription is made, and the state is `not_configured`

### Requirement: Service identity
With `KEYCLOAK_SERVICE_CLIENT_ID` and `KEYCLOAK_SERVICE_CLIENT_SECRET`, the backend SHALL hold a token of its own, and use it only for the subscription and for triggered runs.

#### Scenario: Renewed
- **WHEN** the token is about to end, or a renewal failed
- **THEN** a new one is requested, for as long as it takes

#### Scenario: A triggered run with nobody signed in
- **WHEN** a triggered run reads the platform, and nobody is signed in
- **THEN** its calls carry the service identity's token

#### Scenario: A triggered run while an operator is signed in
- **WHEN** a triggered run reads the platform, and an operator is signed in
- **THEN** its calls carry the service identity's token, if there is one, and otherwise the operator's

#### Scenario: After a restart
- **WHEN** a triggered run's round runs again after a restart
- **THEN** its calls carry the same identity

#### Scenario: A run an operator started
- **WHEN** a run started through `POST /api/agent/run` reads the platform, and nobody is signed in
- **THEN** its calls carry no token

#### Scenario: Other routes
- **WHEN** a route under `/api` calls the platform, and nobody is signed in
- **THEN** it carries no token

#### Scenario: Not configured
- **WHEN** the service client isn't configured
- **THEN** the signed-in operator's token is used, as the only identity there is
