# Proposal

Issue: #31

## Why

The System screen and dashboard report only some of the connections, and a backend build still falls through to mock data for service settings and for what isn't served. An operator can't tell which connection failed, and can take sample data for real data.

## What Changes

- Health checks for `alerta`, `mqtt`, `pgrest`, `gateway`, `dataspace_connector`, `ifric` and `fuseki`, next to the existing four, each with a probe address and a detail hint. A 401 or 403 is a failure. An empty ontology dataset is a warning.
- `GET /api/config` gives read-only service settings. Operators can't override addresses at runtime, and no address is accepted from the browser.
- The backend source no longer delegates to the mock source: a test keeps it that way.
- Automatic archive of finished runs is dropped, and this is recorded in the spec.

**Decisions the issue asks for:** addresses are read-only at runtime, and automatic archive is dropped. See `design.md`.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `backend/service-runtime`: The health report's checks, and `/api/config`.
- `backend/run-api`: Finished runs stay until an operator archives them.
- `operator-ui/system-health`: Settings are read-only on a backend, and checks show their probe and hint.
- `operator-ui/data-source`: The backend source serves everything, without the mock.

## Impact

- `backend/`: `app/health.py`, new `app/api/config.py`, `app/main.py`, `tests/`, `README.md`.
- `frontend/`: `src/data/sources/backend/index.js`, `system.js`, `src/data/interface.js`, `src/features/system/`, `docs/data-interface.md`, `tests/`.
- `architecture.md`: Backend API table, System screen.

## Out of Scope

- Changing addresses at runtime, in any form.
- The knowledge base: with its build setting on, a backend build reports it as unavailable. **RAG is out of scope, as set out in #18.**
- Protecting `/api/config` and `/api/diagnostics`, which #36 covers.
