# Spec Delta

## MODIFIED Requirements

### Requirement: Dataspace token
The backend SHALL get a dataspace token with the client credentials grant from the configured realm, separately from the operator's token, using the client ID from the operator's `ifric_company_id` claim, or else `GATEWAY_CLIENT_ID`.

#### Scenario: Connect with a secret
- **WHEN** the operator connects with a valid secret
- **THEN** the state is `connected`, with the participant ID from the token and its expiry, and no answer holds a token or secret

#### Scenario: Rejected secret
- **WHEN** the identity provider rejects the secret
- **THEN** the request is refused as `unauthorized`, and a secret stored earlier is kept

#### Scenario: Provider unreachable
- **WHEN** the identity provider can't be reached
- **THEN** the request is refused as `unavailable`, which the operator can tell from a rejected secret

#### Scenario: Not configured
- **WHEN** no gateway or no client ID is configured
- **THEN** the state is `not_configured`, and connecting is refused as `conflict`

#### Scenario: Disconnect
- **WHEN** the operator disconnects
- **THEN** the state is `disconnected`, peers are refused as `unavailable`, and the backend does not connect by itself after a restart or sign-in

#### Scenario: Connects by itself
- **WHEN** the backend starts, or an operator signs in while the backend is not connected, and a secret is available and the operator did not disconnect
- **THEN** the backend connects without being asked, with sign-in on or off

## ADDED Requirements

### Requirement: Connection at startup
With a gateway, a client ID and a client secret configured, the backend SHALL connect to the dataspace at startup without anyone signed in, with the same token, renewal and failure handling as a connection made after sign-in. A failure SHALL NOT stop the backend.

#### Scenario: Messages with nobody signed in
- **WHEN** the backend restarts with sign-in on, a configured client, and nobody signed in, and a machine builder sends a message on a run's conversation
- **THEN** the inbox is polled with the backend's token, and the message reaches its run

#### Scenario: Registry with nobody signed in
- **WHEN** the backend has connected at startup and nobody is signed in
- **THEN** registry lookups that need the dataspace token are made with it

#### Scenario: Dataspace unreachable at startup
- **WHEN** the identity provider or the gateway can't be reached at startup
- **THEN** the backend starts and serves requests, the attempt is repeated every 60 seconds, and once the dataspace can be reached it connects without anyone acting

#### Scenario: Credential rejected at startup
- **WHEN** the configured secret is rejected at startup
- **THEN** the backend starts, does not try again by itself, and the status and health say that the credential was rejected

#### Scenario: Stopped trying
- **WHEN** the operator disconnects, or the backend shuts down, while it is still trying to connect
- **THEN** no further attempt is made

#### Scenario: Without a configured client
- **WHEN** the backend starts without `GATEWAY_URL`, or with sign-in on and without `GATEWAY_CLIENT_ID`, or without any secret
- **THEN** no connection is attempted at startup, and behaviour is as before

#### Scenario: An operator of another company signs in
- **WHEN** the backend connected at startup as `GATEWAY_CLIENT_ID`, and an operator whose token names another company signs in
- **THEN** the connection is kept, and the status names the client in use for the connection

#### Scenario: Concurrent attempts
- **WHEN** a sign-in, an operator's connect and a startup retry happen at the same time
- **THEN** one token grant is in effect afterwards, and one renewal loop runs
