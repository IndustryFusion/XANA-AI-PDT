# Spec Delta

## ADDED Requirements

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
- **WHEN** an operator signs in, or the backend starts with sign-in off, and a secret is available and the operator did not disconnect
- **THEN** the backend connects without being asked, and retries at startup if it can't

### Requirement: Token renewal
The backend SHALL check the token every 60 seconds and renew it with 120 seconds or less left. After 3 failures in a row it SHALL stop and report it.

#### Scenario: Renewal
- **WHEN** the token has 120 seconds or less left
- **THEN** a new one replaces it before it runs out

#### Scenario: Repeated failure
- **WHEN** renewing fails 3 times in a row
- **THEN** no further attempts are made, the status reports the failures, and the state becomes `expired` when the token runs out

#### Scenario: Failure followed by success
- **WHEN** a renewal fails and the next one succeeds
- **THEN** the count of failures starts again

#### Scenario: Gateway refuses the token
- **WHEN** the gateway answers `401` to a read
- **THEN** the token is renewed once and the read is repeated, and concurrent reads share one renewal

### Requirement: Encrypted client secret
The client secret SHALL be stored only encrypted, in `gateway_credentials`, with `SETTINGS_ENCRYPTION_KEY`.

#### Scenario: Unreadable in the database
- **WHEN** a secret has been stored
- **THEN** the database row does not hold the secret or any readable part of it

#### Scenario: Survives a restart
- **WHEN** the backend restarts with the same key
- **THEN** it connects with the stored secret, without being given it again

#### Scenario: Another key
- **WHEN** the stored row can't be read with the configured key
- **THEN** connecting without a secret is refused as `conflict`, saying that the secret must be entered again, and nothing falls back to plaintext

### Requirement: Peers and capabilities
The backend SHALL offer, under `/api/gateway`, the compatible peers, their capabilities in both directions, what each peer may access here, incoming capability requests, and setting a policy, from the configured gateway only.

#### Scenario: Peers
- **WHEN** peers are listed while connected
- **THEN** every compatible participant is returned with what it offers, and one peer that can't be read does not fail the list

#### Scenario: Status mapping
- **WHEN** a peer's capabilities are read
- **THEN** both directions are listed, `auto` and `approved` as `granted`, `on-request` and `pending` as `default`, and `denied` as `denied`

#### Scenario: Unknown peer
- **WHEN** the capabilities of a participant that is not compatible are requested
- **THEN** the request is refused as `not_found`

#### Scenario: Decide a request
- **WHEN** an operator approves or denies a pending capability request with a note
- **THEN** the gateway records it and the updated request is returned

#### Scenario: Already decided
- **WHEN** an operator decides a request that was decided meanwhile
- **THEN** the request is refused as `conflict`, naming the decision

#### Scenario: Set a policy
- **WHEN** an operator approves, denies or resets a capability for a peer
- **THEN** the gateway records it, and an unknown action is refused as `invalid` without calling the gateway

#### Scenario: Gateway failing
- **WHEN** the gateway is unreachable or answers `502`, `503` or `504`
- **THEN** the request is refused as `unavailable`, naming the gateway, with no address or token in the message

#### Scenario: Not connected
- **WHEN** peers or requests are read while not connected
- **THEN** the request is refused as `unavailable`, and the gateway is not called
