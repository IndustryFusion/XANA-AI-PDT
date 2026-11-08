# Spec Delta

## ADDED Requirements

### Requirement: Access levels
The backend SHALL give each compatible peer an access level from the capabilities the gateway reports it may access here: `elevated` when one is `approved`, else `restricted` when one is `denied`, else `standard`, with counts per level.

#### Scenario: Levels as the gateway reports them
- **WHEN** one peer has a capability approved, another a capability denied, and a third only defaults, on a real gateway
- **THEN** they are `elevated`, `restricted` and `standard`, and the counts say one of each

#### Scenario: Access can't be read
- **WHEN** a peer's access can't be read
- **THEN** that peer has no level and the reason, is counted as unknown, and the others are given

#### Scenario: Not connected
- **WHEN** the backend is not connected
- **THEN** levels are refused as `unavailable`, as peers are

### Requirement: Configuration without secrets
`/api/gateway/config` SHALL give the gateway address, the identity provider's address and realm, the client ID in use, and the registry address, and never a secret, token, key or password.

#### Scenario: Configured
- **WHEN** the configuration is read with a gateway, a client secret, an encryption key, and an address holding a password
- **THEN** the addresses, realm and client ID are given, the password in the address is masked, and nothing in the answer holds the secret, the key or a token (test)

#### Scenario: Not configured
- **WHEN** no gateway is configured
- **THEN** the answer says so, with no addresses
