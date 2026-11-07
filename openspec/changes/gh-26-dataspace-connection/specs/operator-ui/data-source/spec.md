# Spec Delta

## ADDED Requirements

### Requirement: Dataspace from the backend
The backend data source SHALL serve the connection, peers, capabilities, capability requests and policies of the `dataspace` area from the backend, in the documented shapes.

#### Scenario: Dataspace on real data
- **WHEN** an operator uses the Dataspace screen on the backend data source
- **THEN** connecting, disconnecting, peers, capabilities, requests and policies act on the real gateway

#### Scenario: Renewal failing
- **WHEN** token renewal has failed repeatedly
- **THEN** the connection section says so

#### Scenario: Policy actions
- **WHEN** an operator grants, denies or resets a capability for a peer
- **THEN** the source sends the gateway's approve, deny or reset
