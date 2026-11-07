# Tasks

## 1. Backend

- [x] 1.1 Add the settings, with `GATEWAY_URL` needing a valid key; verify with config tests for a missing and an invalid key, no gateway, and the redactor
- [x] 1.2 Add the `gateway_credentials` migration and encrypted store; verify against PostgreSQL that the row holds no readable secret, and that another key gives `conflict`
- [x] 1.3 Add the connection: grant, client ID choice, status, disconnect; verify with stub tests for a rejected secret, an unreachable provider and each state
- [x] 1.4 Add the renewal loop; verify with a fake clock: renewal at the margin, stop after 3 failures, restart of the count, expiry, and a `401` renewing once under concurrent reads
- [x] 1.5 Add the gateway routes and mapping; verify with stub tests for each status mapping and each refusal
- [x] 1.6 Connect after sign-in and at startup, keeping a disconnect; verify with tests including a restart
- [x] 1.7 Add `gateway` and `connector` to health; verify with tests for each state

## 2. Frontend

- [x] 2.1 Serve the `dataspace` operations from the backend source, with the renewal detail on the screen; verify with source tests and shapes

## 3. Deployment

- [x] 3.1 Add settings and secrets to the chart and local environment; verify with `helm template` and `docker compose config`

## 4. Verification on a real dataspace

- [x] 4.1 Connect, disconnect and show state against a real gateway and Keycloak; verify from a backend run from source
- [x] 4.2 Peers and capabilities shown from a real gateway; verify with a real machine-builder participant
- [x] 4.3 Approve and deny requests and set a policy against a real gateway; verify that the peer's own view changes
- [x] 4.4 Real token renewal, and repeated failure with Keycloak stopped; verify on the real services
- [x] 4.5 The Dataspace screen works through a browser against the real gateway

## 5. Documents

- [x] 5.1 Update `backend/README.md`, `helm/README.md`, `frontend/docs/data-interface.md`, `architecture.md`; verify by searching for each setting
