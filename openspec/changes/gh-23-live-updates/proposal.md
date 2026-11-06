# Proposal

Issue: #23

## Why

Operators working in the Data Explorer should see changes to the twin as they happen. Today that exists only on the mock. The agent doesn't use it.

## What Changes

- The backend creates a 24 hour Scorpio subscription with an MQTT endpoint on the platform's EMQX broker, subscribes to its topic, and renews it when the token rotates and before it expires.
- `/api/ngsi/ws` streams changes to the browser. `/api/ngsi/subscription-health` reports the state.
- It starts after sign-in, or at startup when sign-in is off, and removes the subscription on sign-out and shutdown.
- If the broker is unavailable, the explorer works without live updates, says so, and recovers.
- Settings: `MQTT_BROKER_URL`, `MQTT_MGMT_URL`, `MQTT_BROKER_NOTIFY_URL`.
- A new runtime dependency, an MQTT client (see design).
- EMQX in the local environment under a profile.

## Capabilities

### New Capabilities

- `backend/live-updates`: The subscription, its renewal, the stream and its health.

### Modified Capabilities

- `backend/service-runtime`: Tokens are masked wherever an address carries them.
- `backend/local-environment`: Optional EMQX.
- `operator-ui/data-source`: The backend source serves `subscribeEntities` and `getLiveUpdateHealth`.
- `operator-ui/data-explorer`: Recovery after the broker returns.

## Impact

- `backend/`: new `app/ngsi/live.py`; changes in `pyproject.toml`, `app/api/ngsi.py`, `app/api/auth.py`, `app/config.py`, `app/redact.py`, `app/main.py`, `compose.yaml`, `.env.example`, `README.md`.
- `frontend/`: backend `entities.js`, `vite.config.js`, `docs/data-interface.md`.
- `helm/`: broker settings.
- `architecture.md`: Data explorer, Key Variable Groups.

## Out of Scope

- The agent reading live updates.
- A service account for the subscription, and per-operator sessions (#36).
- Notifying entity deletions, which the broker does not send.
- Changes to the platform's EMQX, its authentication service or its Keycloak setup.
