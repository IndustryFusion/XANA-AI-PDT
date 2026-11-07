# Spec Delta

## ADDED Requirements

### Requirement: Access level per peer
The peer list SHALL show each peer's access level without opening the peer.

#### Scenario: Levels in the list
- **WHEN** the operator opens the Dataspace area while connected
- **THEN** each listed peer shows its level as the backend reports it, or that it is unknown

### Requirement: Configuration panel
The Dataspace area SHALL show the gateway and registry configuration: addresses, realm, client ID and connection state, and never a secret.

#### Scenario: Configuration shown
- **WHEN** the operator opens the Dataspace area
- **THEN** the gateway address, the identity provider's address and realm, the client ID, the registry address and the connection state are shown

#### Scenario: No secret
- **WHEN** the configuration panel is shown
- **THEN** it holds no secret, token or password (test)

### Requirement: Names from the registry on screens
Screens that show a machine ID SHALL show its asset name with it when the registry gives one, and peers and factories SHALL show their names, and SHALL keep working with IDs when the registry is unavailable.

#### Scenario: Names shown
- **WHEN** the registry knows a machine, a peer and the factory
- **THEN** the run list, run view, incident history and Dataspace area show their names with the IDs

#### Scenario: Registry unavailable
- **WHEN** the registry is unavailable
- **THEN** the same screens show IDs and work otherwise as before
