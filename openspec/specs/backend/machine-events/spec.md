# backend/machine-events Specification

## Purpose
Starts runs from machine events: notifications from the context broker and alerts, through authenticated webhooks, without losing events the process has accepted.

## Requirements

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

#### Scenario: Body too large
- **WHEN** a body is over 10 MiB
- **THEN** it is answered 413, and nothing is queued

#### Scenario: Queue full
- **WHEN** the queue is full
- **THEN** the call is answered 503, and says so

### Requirement: Events from the context broker
The backend SHALL read each entity of a notification that has an ID as an event for that machine, with an issue naming the watched values, whether attributes have short names or full IRIs. Every such event SHALL start a run, unless a run is in progress for that machine as below. Values are not compared with those reported before.

#### Scenario: A status change
- **WHEN** a notification reports a machine's `status`
- **THEN** one run starts for that machine, with an issue naming the value

#### Scenario: The same values again
- **WHEN** a notification repeats the watched values reported before, also after a restart, and no run is in progress for the machine
- **THEN** a run starts

#### Scenario: No watched value
- **WHEN** an entity of a notification holds none of the watched values
- **THEN** a run starts, with the issue `Machine event: state change detected`

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

### Requirement: One worker, one run in progress per machine
One worker SHALL handle events in order, and an event SHALL start nothing while a run that an event started for the same machine is in progress: from its start until its first analysis ends, by completing, failing, being stopped or pausing for the operator. Runs an operator started, and rounds after the first pause, don't count.

#### Scenario: Repeated events during a run
- **WHEN** events for a machine arrive while a run an event started for it is in its first analysis, also at the same moment
- **THEN** exactly one run exists for it

#### Scenario: While paused
- **WHEN** an event arrives while the machine's triggered run waits for the operator or the machine builder
- **THEN** a new run starts

#### Scenario: After the operator answers
- **WHEN** a triggered run goes on after the operator's answer or confirmation, and an event for that machine arrives
- **THEN** a new run starts

#### Scenario: After the run ended
- **WHEN** the run is `completed`, `failed`, `stopped` or `mb_closed`, and an event arrives
- **THEN** a new run starts, unless a triggered run of that machine failed lately, as below

#### Scenario: An operator's run
- **WHEN** a run an operator started for that machine is in progress or paused, and an event arrives
- **THEN** a run starts for the event, and the operator can still start runs

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

#### Scenario: Data the database can't store
- **WHEN** an event holds a NUL or a lone surrogate, in its machine, issue or values
- **THEN** those are left out, an event with no machine or issue left is refused, and if the database refuses the data for what it is, or its size, it is logged and the next event is handled

#### Scenario: A database that can't write for now
- **WHEN** the database refuses for any other reason, such as being read-only
- **THEN** the worker tries again until it can, and one run starts

#### Scenario: A triggered run just failed
- **WHEN** a triggered run of a machine failed within the last 5 minutes, and another event for it arrives
- **THEN** no run starts yet, and the latest event per machine and source starts once the wait ends, with no further event needed

#### Scenario: A short name with the broker down
- **WHEN** an event's short name can't be resolved, and the identifier of a run in progress ends in that name
- **THEN** no run starts

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
- **WHEN** the broker refuses, including with 401 or 403, reading the subscription by ID, listing subscriptions and updating it, or refuses creating it
- **THEN** the state is `failed`, says why without a secret, and it is tried again

#### Scenario: Not delivered
- **WHEN** the broker reports `notification.status` as `failed`
- **THEN** the state is `delivery_failing`

#### Scenario: Not configured
- **WHEN** `CALLBACK_BASE_URL` isn't set
- **THEN** no subscription is made, the state is `not_configured`, and the check says that one made earlier goes on delivering until deleted

#### Scenario: In a tenant
- **WHEN** `NGSI_TENANT` is set
- **THEN** the subscription is made, the backend starts, and the state says that the broker delivers nothing there unless the same context is subscribed in its default tenant

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

### Requirement: Checking the machine-watch subscription
At least once a minute, the backend SHALL check that the machine-watch subscription is still in place: by reading it by its ID, or, when that read is refused with 401 or 403, by finding it in the broker's list of subscriptions, or else by updating it. A refused read by ID alone SHALL NOT make the state `failed`, and SHALL NOT count as the subscription being gone.

#### Scenario: Only the read by ID refused
- **WHEN** the broker refuses reading the subscription by its ID with 403, and lists it or accepts its update
- **THEN** the check doesn't make the state `failed`, and the state is the one delivery reports, such as `active`, over several checks

#### Scenario: In place again after a failed check
- **WHEN** the state is `failed`, and a later try finds the subscription in place, updates it or creates it again
- **THEN** the state is again the one delivery reports, such as `active`

#### Scenario: Gone, while the read by ID is refused
- **WHEN** the broker refuses reading by ID, and the subscription isn't in its list, or an update is answered as not found
- **THEN** it is created again

#### Scenario: Delivery status from the list
- **WHEN** the read by ID is refused, and the list entry reports `notification.status` as `failed`
- **THEN** the state is `delivery_failing`

#### Scenario: Nothing works
- **WHEN** the broker refuses reading by ID, listing subscriptions and updating the subscription
- **THEN** the state is `failed`, and the reason gives the HTTP status of the last answer and, for 401 or 403, that the identity lacks access, without the broker's message or a secret
