# Proposal

Issue: #21

## Why

The sign-in screen works only against the mock, and the backend's calls to Scorpio carry no token, so a broker that requires one refuses them. Later issues (#23, #26, #24) also need the operator's token and its claims.

## What Changes

- Add `/api/auth/config`, `connect`, `logout` and `status`. The backend signs in to Keycloak on the operator's behalf, and keeps the token fresh.
- Send the token to Scorpio from the agent, machine name lookups and the health check.
- Connect the sign-in screen and Session section to the backend, including the token countdown.
- Offer a place to start what depends on sign-in.
- Add Keycloak to the local environment, with a realm holding the `scorpio` client, claim mappers and a test user.

## Capabilities

### New Capabilities

- `backend/authentication`: Signing in through Keycloak, keeping the session, and using its token for platform services.

### Modified Capabilities

- `backend/local-environment`: Optional Keycloak.
- `operator-ui/data-source`: Session served by the backend.
- `operator-ui/system-health`: Token countdown in the session state.

## Impact

- `backend/`: new `app/auth.py`, `app/api/auth.py`, and `keycloak/`; changes in `app/config.py`, `app/errors.py`, `app/health.py`, `app/main.py`, `app/runs/machines.py`, the agent's `sources/ngsi.py`, `.env.example`, `compose.yaml`, `README.md`.
- `frontend/`: backend session source, `SessionSection.jsx`, mock session, data interface.
- `helm/`: Keycloak settings.
- `architecture.md`: frontend and backend sections, Key Variable Groups.

## Out of Scope

- The dataspace token (#26), the factory details from the registry (#27), and live updates (#23).
- Tokens for other platform services, which each later issue adds.
- Changes to the digital twin platform's Keycloak setup.
