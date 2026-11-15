## MODIFIED Requirements

### Requirement: Dataspace token
The backend SHALL get a dataspace token with the client credentials grant from the configured realm, separately from the operator's token, using the client ID from the operator's `ifric_company_id` claim, or else `GATEWAY_CLIENT_ID`.

#### Scenario: Connect with a secret
- **WHEN** the operator connects with a valid secret
- **THEN** the state is `connected`, with the participant ID from the token and its expiry, and no answer holds a token or secret

#### Scenario: Rejected secret
- **WHEN** the identity provider rejects the secret
- **THEN** the request is refused as `unauthorized`, and a secret stored earlier is kept

#### Scenario: Details of a refusal
- **WHEN** connecting fails at the identity provider or the gateway
- **THEN** the refusal names the step, and gives the address called with any credentials masked, the client, the HTTP status, and the identity provider's OAuth error code, and never the secret, a token or another service's message

#### Scenario: Provider unreachable
- **WHEN** the identity provider can't be reached
- **THEN** the request is refused as `unavailable`, which the operator can tell from a rejected secret

#### Scenario: Not configured
- **WHEN** no gateway or no client ID is configured
- **THEN** the state is `not_configured`, and connecting is refused as `conflict`

#### Scenario: Sign-in needed
- **WHEN** the gateway and its identity provider are configured but no client is known, from the operator's claim or the configuration
- **THEN** the state is `not_configured` and the status says that a sign-in is needed

#### Scenario: Disconnect
- **WHEN** the operator disconnects
- **THEN** the state is `disconnected`, peers are refused as `unavailable`, and the backend does not connect by itself after a restart or sign-in

#### Scenario: Connects by itself
- **WHEN** the backend starts, or an operator signs in while the backend is not connected, and a secret is available and the operator did not disconnect
- **THEN** the backend connects without being asked, with sign-in on or off

### Requirement: Peers and capabilities
The backend SHALL offer, under `/api/gateway`, the compatible peers, their capabilities in both directions, what each peer may access here, incoming capability requests, and setting a policy, from the configured gateway only.

#### Scenario: Peers
- **WHEN** peers are listed while connected
- **THEN** every compatible participant is returned with what it offers, its participant type and what it was approved here, and one peer that can't be read does not fail the list

#### Scenario: Status mapping
- **WHEN** a peer's capabilities are read
- **THEN** both directions are listed, `auto` and `approved` as `granted`, `on-request` and `pending` as `default`, and `denied` as `denied`, each with the gateway's own status beside it, and nothing for a status the gateway doesn't define

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
