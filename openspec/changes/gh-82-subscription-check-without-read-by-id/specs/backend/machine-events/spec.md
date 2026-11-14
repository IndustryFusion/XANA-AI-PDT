# Spec Delta

## MODIFIED Requirements

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

## ADDED Requirements

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
