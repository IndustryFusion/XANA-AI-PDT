# operator-ui/dataspace Specification

## Purpose
Lets operators manage the factory's IFF Dataspace connection, see which machine builders they can work with and what each may access, decide on capability requests, and understand what data leaves the factory.

## Requirements

### Requirement: Connection
The Dataspace area SHALL show, in one gateway card, the connection state once, the session token's validity with its expiry and the time left, the own participant identifier and factory identity, and let the operator connect and disconnect.

#### Scenario: Connected
- **WHEN** the operator opens the Dataspace area while connected
- **THEN** the state, the token's expiry and time left, participant identifier and factory are shown, with a disconnect action

#### Scenario: Connect with a credential
- **WHEN** the connection is not established and the configuration provides no credential
- **THEN** a connect form asks for the credential, and connecting with a valid one shows the connected state

#### Scenario: Connect fails
- **WHEN** connecting fails because the credential is rejected or the gateway is unreachable
- **THEN** the form stays with a message that distinguishes the two causes

#### Scenario: Details of a failed connect
- **WHEN** connecting fails
- **THEN** a disclosure names the step that failed and gives the address it called with credentials masked, the client, the HTTP status and the identity provider's error code, and never a secret, a token or another service's message

#### Scenario: Time left
- **WHEN** the session token is valid
- **THEN** the time left counts down, and in its last minute it is marked as about to renew

#### Scenario: Token renewed
- **WHEN** the token is renewed
- **THEN** the time left starts again from the new expiry, and the mark is gone

#### Scenario: Disconnect
- **WHEN** the operator disconnects and confirms
- **THEN** the state becomes disconnected, the header indicator updates, and peers are no longer listed

### Requirement: Compatible peers
When connected, the Dataspace area SHALL list compatible peers, and for a selected peer show the capabilities in both directions: what this factory may access at the peer and what the peer may access here.

#### Scenario: Peer capabilities
- **WHEN** the operator selects a peer
- **THEN** both directions are listed per capability with the status the gateway applies: auto, on request, pending, approved or denied

#### Scenario: Capability names
- **WHEN** the gateway gives a capability a label and a description
- **THEN** they are shown with the capability's identifier, and the page's own names only where the gateway gives none

#### Scenario: No peers
- **WHEN** no compatible peer exists
- **THEN** the list says that no compatible peers were found in the dataspace

### Requirement: Capability requests
The Dataspace area SHALL list incoming capability requests with requester, capability and date, and let the operator approve or deny each with an optional note.

#### Scenario: Approve a request
- **WHEN** the operator approves a pending request
- **THEN** the request shows as approved and the peer's capabilities reflect the grant

#### Scenario: Request already decided
- **WHEN** the operator acts on a request that was decided meanwhile
- **THEN** the current decision is shown and no change is made

### Requirement: Peer policy
The operator SHALL be able to approve, deny or reset to default a capability for a peer, after confirmation, with the actions that fit its status: deny when it is auto, approve or deny when it is on request or pending, deny or reset when it is approved, and approve or reset when it is denied.

#### Scenario: Approve a capability on request
- **WHEN** the operator approves a capability that is on request for a peer and confirms
- **THEN** the capability shows as approved, and it offers deny and reset

#### Scenario: Deny a capability
- **WHEN** the operator denies a capability for a peer and confirms
- **THEN** the capability shows as denied for that peer

### Requirement: Data-sharing tier explained
The Dataspace area SHALL show the configured data-sharing tier in one line of the gateway card, and explain behind a disclosure in plain words what each tier sends: the machine twin only, plus neighbouring machines, or plus machine history.

#### Scenario: Tier shown
- **WHEN** the operator opens the Dataspace area
- **THEN** the configured tier is named in one line, and opening the disclosure marks it and describes each tier with the data it shares

### Requirement: Area works when disconnected or failing
The Dataspace area SHALL remain usable when the dataspace is not configured, disconnected or failing, showing what is unavailable and why.

#### Scenario: Not configured
- **WHEN** no dataspace connection is configured
- **THEN** the area says so, explains that escalation to machine builders is unavailable, and offers no connect form

#### Scenario: Sign in first
- **WHEN** the gateway is set up but no client is known, as the operator's sign-in carries no company and none is configured
- **THEN** the area asks the operator to sign in, instead of saying that no connection is configured, and offers no connect form

### Requirement: Access level per peer
The peer list SHALL show each peer's access level and participant type without opening the peer, and for an elevated peer the capabilities granted beyond its defaults, marked by how much each reveals.

#### Scenario: Levels in the list
- **WHEN** the operator opens the Dataspace area while connected
- **THEN** each listed peer shows its level as the backend reports it, or that it is unknown

#### Scenario: Grants in the list
- **WHEN** a peer has been granted capabilities beyond its defaults
- **THEN** its entry names them, each marked as low, medium or high sensitivity in text as well as colour

### Requirement: Configuration panel
The Dataspace area SHALL show the gateway and registry configuration in the gateway card: addresses, realm, participant and connection state, and never a secret.

#### Scenario: Configuration shown
- **WHEN** the operator opens the Dataspace area
- **THEN** the gateway address, the identity provider's address and realm, the participant, the registry address and the connection state are shown, the state only once

#### Scenario: No secret
- **WHEN** the gateway card is shown
- **THEN** it holds no secret, token value or password (test)

### Requirement: Names from the registry on screens
Screens that show a machine ID SHALL show its asset name with it when the registry gives one, and peers and factories SHALL show their names, and SHALL keep working with IDs when the registry is unavailable.

#### Scenario: Names shown
- **WHEN** the registry knows a machine, a peer and the factory
- **THEN** the run list, run view, incident history and Dataspace area show their names with the IDs

#### Scenario: Registry unavailable
- **WHEN** the registry is unavailable
- **THEN** the same screens show IDs and work otherwise as before
