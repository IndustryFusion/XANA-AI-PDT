# Spec Delta

## ADDED Requirements

### Requirement: Subscription for live updates
The backend SHALL create one context broker subscription with an MQTT endpoint on the configured broker, valid for 24 hours, and subscribe to its topic. It SHALL start after sign-in, or at startup when sign-in is off. Callers SHALL NOT be able to choose the addresses.

#### Scenario: After sign-in
- **WHEN** an operator signs in
- **THEN** the subscription exists, expiring within 24 hours, and the backend is subscribed to its topic

#### Scenario: Nobody signed in
- **WHEN** sign-in is on and nobody has signed in
- **THEN** no subscription is created, and the state says it is waiting for sign-in

#### Scenario: Sign-in off
- **WHEN** sign-in is off
- **THEN** the subscription is created at startup, without a token

### Requirement: Renewal
The backend SHALL renew the subscription when the token rotates and before it expires, without a gap in updates. If the subscription has gone, it SHALL create it again.

#### Scenario: Token rotates
- **WHEN** the session's token is refreshed
- **THEN** the subscription carries the new token, and updates continue past the old token's expiry

#### Scenario: Close to expiry
- **WHEN** the subscription has less than an hour left
- **THEN** its expiry moves to 24 hours from now

#### Scenario: Removed in the broker
- **WHEN** the subscription no longer exists in the context broker
- **THEN** it is created again within a minute

### Requirement: Nothing left behind
The backend SHALL delete its subscription on sign-out and on shutdown, and SHALL remove subscriptions an earlier process left, when it next starts.

#### Scenario: Sign-out
- **WHEN** the operator signs out
- **THEN** the subscription is deleted from the broker, and the sign-out succeeds even if deleting fails

#### Scenario: Shutdown
- **WHEN** the backend shuts down
- **THEN** the subscription is deleted

#### Scenario: Earlier process
- **WHEN** a process ended without deleting its subscription
- **THEN** the next start after sign-in removes it, and exactly one remains

### Requirement: Stream to the browser
`/api/ngsi/ws` SHALL send each change as the changed entity's ID and attributes, filtered by the type or IDs the client states. Attribute names SHALL be unchanged.

#### Scenario: Matching change
- **WHEN** a client watches an entity and that entity changes in the context broker
- **THEN** the client receives its attributes with no reload

#### Scenario: Other entities
- **WHEN** another entity changes
- **THEN** the client does not receive it

#### Scenario: Many clients at once
- **WHEN** several clients watch while many changes arrive
- **THEN** each receives all of its changes, in order

#### Scenario: Slow client
- **WHEN** one client stops reading
- **THEN** the others are not held up, and that client is closed rather than silently losing changes

#### Scenario: Not a notification
- **WHEN** a malformed message arrives on the topic
- **THEN** it is dropped and streaming continues

### Requirement: State of live updates
`/api/ngsi/subscription-health` SHALL report whether updates can be delivered, the state and a readable reason. It SHALL NOT hold the endpoint or a token.

#### Scenario: Working
- **WHEN** the subscription is active and the backend is connected
- **THEN** the status is `ok`, with the expiry

#### Scenario: Broker unavailable
- **WHEN** the MQTT broker cannot be reached
- **THEN** the status is `unavailable`, the reason says so, and every other route keeps working

#### Scenario: Broker returns
- **WHEN** the MQTT broker returns
- **THEN** the backend reconnects by itself, the status returns to `ok`, and updates resume

#### Scenario: Refused
- **WHEN** the broker refuses the operator's token
- **THEN** the status is `unavailable`, and the reason names the role that is needed

#### Scenario: Context broker unavailable
- **WHEN** the subscription cannot be created or renewed
- **THEN** the status is `unavailable`, and the backend keeps trying
