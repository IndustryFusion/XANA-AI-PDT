# Proposal

Issue: #30

## Why

A run starts only when an operator asks for one. When a machine reports a problem, or an alert fires, with nobody watching, nothing happens until somebody looks. Runs should start by themselves, and be handled like any other run.

## What Changes

- `POST /events/ngsi` and `POST /events/alert` add to a bounded queue, read by one worker. Every event starts a run, unless a run that an event started for that machine is still in its first analysis.
- A context broker subscription with the stable ID `urn:ngsi-ld:Subscription:XanaPDT:MachineWatch`, on type `Machine`, watching `status`, `errorCode`, `alarmLevel` and `faultCode`, delivered to `{CALLBACK_BASE_URL}/events/ngsi`. It is created when an identity is available, retried until it is, and its state is a check in the health report.
- Values are not compared with those reported before: a notification repeating them starts a run too, as a maintainer decided.
- A service identity: a Keycloak client of its own with client credentials, used for the subscription and for triggered runs. This settles what #36 leaves to this issue.
- Webhook callers present a shared secret. See `design.md`.
- A small Alerta plugin that sends new alerts to `POST /events/alert`, as Alerta has no outbound webhook of its own.
- Runs and incidents record their `source` (`operator`, `ngsi` or `alert`), and the screens show it.

**Decisions the issue asks for:** webhook callers are authenticated by a shared secret in the `Authorization` header. See `design.md` for the alternatives.

## Capabilities

### New Capabilities

- `backend/machine-events`: The webhooks, the queue and worker, the subscription and the service identity.

### Modified Capabilities

- `backend/run-api`: Runs have a `source`.
- `backend/incident-records`: Incidents have a `source`.
- `backend/service-runtime`: The health report has a `machine_events` check, and the new secrets stay secret.
- `backend/local-environment`: Alerta can send to the backend, and the realm has a service client.
- `deployment/kubernetes`: The new settings and secrets.
- `operator-ui/active-incidents`: Lists show where a run came from.
- `operator-ui/data-source`: The interface carries `source`.

## Impact

- `backend/`: new `app/events/`, `app/api/events.py`, `alerta/plugin/`, `migrations/007_machine_events.sql`; changes in `app/main.py`, `app/config.py`, `app/health.py`, `app/runs/manager.py`, `app/runs/model.py`, `app/memory/store.py`, `compose.yaml`, `keycloak/realm-iff.json`.
- `frontend/`: `src/data/interface.js`, the mock source, `ActiveIncidents.jsx`, `RunView.jsx`, `IncidentHistory.jsx`, `Dashboard.jsx`, `docs/data-interface.md`.
- `helm/`: values and `README.md`.
- `architecture.md`: Backend API table, Event Layer.

## Out of Scope

- Per-operator sessions and API protection (#36). `POST /api/agent/run` stays as open as it is today, and never uses the service identity.
- Changes to the digital twin platform. The platform's Alerta has to load the plugin; see `design.md`.
- Keeping events across a restart: the queue is in memory. See `design.md`.
- Roles for the service identity, beyond what the platform asks of any reader.
