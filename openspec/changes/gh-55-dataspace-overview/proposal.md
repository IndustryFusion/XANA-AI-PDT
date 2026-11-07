# Proposal

Issue: #55

## Why

Operators can't see at a glance which machine builders have more access to the factory's data than the defaults, the Dataspace screen doesn't show how the connection is configured, the data-request approval doesn't show what the builder can already access, and names fall back to IDs wherever the registry's company details don't answer.

## What Changes

- **Access levels.** The backend gives each compatible peer an access level from what the gateway reports it may access here: `elevated` with any capability `approved` for it, else `restricted` with any `denied`, else `standard`. A peer whose access can't be read has no level and says why. The dashboard's dataspace tile counts peers per level and names those with elevated access; the Dataspace screen shows each peer's level in the list.
- **Configuration.** The Dataspace screen shows the gateway address, the identity provider's address and realm, the client ID in use, the registry address, and the connection state. No secret, token or password in an address is shown.
- **Approving a data request.** The approval panel shows what the machine builder may access here at that moment, read from the gateway when the panel opens and again on request.
- **Names from the registry.** A company that its details don't name is looked up in the registry's company directory; a factory ID is named by its owner; machines are named by their asset names, through a new `/api/ifric/resolve-machines`. Screens that show machine IDs show the asset name with them. Everything still works, with IDs, when the registry is unavailable.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `backend/dataspace-connection`: Access levels, and the configuration with addresses.
- `backend/ifric-registry`: Company directory, factory owner names and asset names.
- `operator-ui/dashboard`: Access levels in the dataspace tile.
- `operator-ui/dataspace`: Level per peer, and the configuration panel.
- `operator-ui/machine-builder-conversation`: The builder's current access in the approval panel.

## Impact

- `backend/`: `app/dataspace/gateway.py`, `app/dataspace/connection.py`, `app/api/gateway.py`, `app/ifric.py`, `app/api/ifric.py`, tests.
- `frontend/`: the dashboard's dataspace tile, the Dataspace screen, the approval panel, machine names in the run list, run view and incident history, both data sources, `docs/data-interface.md`, tests.
- `architecture.md`: the `/api/gateway/*` and `/api/ifric/*` rows.
- The registry service is used read-only, through routes it already has.

## Out of Scope

- Changing access from the dashboard.
- Names inside the Data explorer's entity documents.
- Changes to the registry service or the dataspace contract.
