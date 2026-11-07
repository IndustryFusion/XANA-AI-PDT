# Proposal

Issue: #51

## Why

With sign-in on, the backend connects to the dataspace only after an operator signs in (`gh-26-dataspace-connection`). After a restart, until someone signs in, the inbox is not polled, machine-builder replies wait, and registry lookups that need the dataspace token fail. The backend has its own client for the dataspace, so it does not need an operator to connect.

## What Changes

- The backend connects to the dataspace at startup whenever a client is configured (`GATEWAY_URL`, `GATEWAY_CLIENT_ID` and a client secret from `GATEWAY_CLIENT_SECRET` or the stored row), with sign-in on as well as off. The connection is the same as one made after sign-in: same token, same renewal, same stored secret, and a stored disconnect is still respected.
- A connection that can't be made because the dataspace can't be reached is retried every 60 seconds until it is made, the operator disconnects, or the backend stops. A rejected credential is not retried. Neither stops the backend.
- The `dataspace_connector` health check says why the backend is not connected, and whether it is still trying.
- The connection status names the client ID actually in use, so an operator whose token carries another company can see which identity the backend acts as.
- An operator signing in keeps a connection that is already made, as now.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `backend/dataspace-connection`: Connecting at startup with sign-in on, retrying while the dataspace is unreachable, and which client is in use.
- `backend/service-runtime`: The connector check says why the backend isn't connected.

## Impact

- `backend/`: `app/dataspace/connection.py`, `app/main.py`, `app/health.py` and their tests; `README.md`.
- `architecture.md`: the "Dataspace connection" paragraph under Configuration, to say the backend connects at startup.
- No change to the chart, the frontend, the database or the published contracts.

## Out of Scope

- Per-operator dataspace identities and protecting the backend's API (#36).
- Changing renewal, the stored secret or the gateway routes.
- Connecting without a configured `GATEWAY_CLIENT_ID`: with sign-in on and nobody signed in, there is no company claim to fall back on, so nothing changes for such a deployment.
