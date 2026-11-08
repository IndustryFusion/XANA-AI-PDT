# Spec Delta

## ADDED Requirements

### Requirement: Why the dataspace is not connected
When the backend is not connected to a configured dataspace, the `dataspace_connector` check SHALL say why the last attempt failed, and whether the backend is still trying, without addresses, tokens or secrets.

#### Scenario: Still trying
- **WHEN** connecting at startup failed because the dataspace can't be reached
- **THEN** `dataspace_connector` is `degraded`, and its detail gives the reason and says that the backend tries again

#### Scenario: Stopped trying
- **WHEN** connecting failed because the credential was rejected
- **THEN** `dataspace_connector` is `degraded`, and its detail says that the credential was rejected and that the backend does not try again by itself

#### Scenario: Connected afterwards
- **WHEN** a later attempt succeeds
- **THEN** the detail no longer names the earlier failure
