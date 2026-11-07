# Proposal

Issue: #26

## Why

The Dataspace screens run on the mock, so XANA cannot take part in the dataspace. Escalation (#28) and the conversation (#29) need a connection, with a token of its own, to the gateway.

## What Changes

- A connection to the dataspace gateway with a `client_credentials` token from the dataspace realm, separate from the operator's token. It is checked every 60 seconds, renewed 120 seconds before it runs out, and renewal stops after 3 failures in a row, which the operator sees.
- The client secret is stored encrypted in a `gateway_credentials` table with `SETTINGS_ENCRYPTION_KEY`. There is no plaintext fallback, and a backend with `GATEWAY_URL` but no usable key stops at startup with a clear message.
- Backend routes under `/api/gateway`: `config`, `status`, `connect`, `disconnect`, `token-claims`, `peers`, `peers/{id}/capabilities`, `policies`, `capabilities/requests`, `capabilities/policy`. The backend connects by itself after sign-in, or at startup when sign-in is off, if the configuration allows it.
- The backend data source serves the `dataspace` area's connection, peers, capabilities and requests. Dataspace access statuses are mapped to `granted`, `denied` and `default`.
- `gateway` and `connector` checks in the health report.
- `DATA_SHARING_POLICY` setting, shown on the Dataspace screen. #28 applies it.

## Capabilities

### New Capabilities

- `backend/dataspace-connection`: Connection, token, stored secret and gateway routes.

### Modified Capabilities

- `backend/service-runtime`: Gateway settings, encryption key, and two more health checks.
- `operator-ui/data-source`: The backend source serves the connection, peers and capability requests.
- `deployment/kubernetes`: Gateway settings, the encryption key and the client secret.

## Impact

- `backend/`: new `app/dataspace/`, `app/api/gateway.py`, `migrations/004_gateway_credentials.sql`; changes in `app/config.py`, `app/main.py`, `app/health.py`, `pyproject.toml`, `.env.example`, `README.md`, `compose.yaml`. New runtime dependency: `cryptography`.
- `frontend/`: new `src/data/sources/backend/dataspace.js`; `docs/data-interface.md`, and a detail line in `ConnectionSection.jsx`. Peer names stay the participant ID until #27.
- `helm/`: gateway settings and secrets.
- `architecture.md`: API Layer, Configuration (`GATEWAY_KEYCLOAK_REALM` defaults to `dataspace`, as `keycloak.md` in the dataspace repository sets it).

## Out of Scope

- Sending or receiving messages: #28 and #29.
- Company names and the factory: #27.
- Protecting the backend's own API, as recorded in `gh-21-keycloak-sign-in`.
