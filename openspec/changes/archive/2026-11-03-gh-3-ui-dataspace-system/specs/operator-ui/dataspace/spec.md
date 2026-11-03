# Spec Delta

## Purpose

Lets operators manage the factory's IFF Dataspace connection, see which machine builders they can work with and what each may access, decide on capability requests, and understand what data leaves the factory.

## ADDED Requirements

### Requirement: Connection
The Dataspace area SHALL show the connection state, session validity and expiry, the own participant identifier and factory identity, and let the operator connect and disconnect.

#### Scenario: Connected
- **WHEN** the operator opens the Dataspace area while connected
- **THEN** the state, session expiry, participant identifier and factory are shown, with a disconnect action

#### Scenario: Connect with a credential
- **WHEN** the connection is not established and the configuration provides no credential
- **THEN** a connect form asks for the credential, and connecting with a valid one shows the connected state

#### Scenario: Connect fails
- **WHEN** connecting fails because the credential is rejected or the gateway is unreachable
- **THEN** the form stays with a message that distinguishes the two causes

#### Scenario: Disconnect
- **WHEN** the operator disconnects and confirms
- **THEN** the state becomes disconnected, the header indicator updates, and peers are no longer listed

### Requirement: Compatible peers
When connected, the Dataspace area SHALL list compatible peers, and for a selected peer show the capabilities in both directions: what this factory may access at the peer and what the peer may access here.

#### Scenario: Peer capabilities
- **WHEN** the operator selects a peer
- **THEN** both directions are listed per capability with granted, denied or default status

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
The operator SHALL be able to grant, deny or reset to default a capability for a peer, after confirmation.

#### Scenario: Deny a capability
- **WHEN** the operator denies a capability for a peer and confirms
- **THEN** the capability shows as denied for that peer

### Requirement: Data-sharing tier explained
The Dataspace area SHALL show the configured data-sharing tier and explain in plain words what each tier sends: the machine entity only, plus linked components, or plus signal history.

#### Scenario: Tier shown
- **WHEN** the operator opens the Dataspace area
- **THEN** the configured tier is marked and each tier is described with the data it shares

### Requirement: Area works when disconnected or failing
The Dataspace area SHALL remain usable when the dataspace is not configured, disconnected or failing, showing what is unavailable and why.

#### Scenario: Not configured
- **WHEN** no dataspace connection is configured
- **THEN** the area says so, explains that escalation to machine builders is unavailable, and offers no connect form
