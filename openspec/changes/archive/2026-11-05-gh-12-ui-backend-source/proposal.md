# Proposal

Issue: #12

## Why

After `gh-12-run-api`, the backend runs real diagnoses, but the UI still talks only to its mock. This change adds the backend data source that the UI data interface was designed for. An operator can then start an incident in the UI and watch the real agent work, confirm or reject its resolution, and find the incident in the history. It is the last of four changes delivering issue #12.

## What Changes

- Add a `backend` data source in `frontend/src/data/sources/backend/`, selected with `VITE_DATA_SOURCE=backend`. It covers:
  - **runs:** list, start, get, live stream, clarify, confirm or reject, stop, archive, escalation preflight and reopen;
  - **incidents:** list, get, reopen;
  - **system:** health.
- Every other operation of the interface is delegated to the mock source, so the whole UI stays usable while later phases bring their backends. Examples: session, entities, alerts, dataspace, the remaining run operations, and system settings.
- The live run stream reconnects on its own after a lost connection and starts again from the run's current state, as the interface prescribes.
- Backend errors map to the interface's error kinds; a backend that cannot be reached shows as `unavailable` in the affected area only.
- An end-to-end test suite runs the UI against the real backend in the local environment with the scripted language model, in CI.
- `frontend/docs/data-interface.md` documents the backend source and which operations it serves.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `operator-ui/data-source`:
  - **Configurable data source** changes: the UI still obtains data from one configured data source, but the backend data source may delegate operations to the mock source.
  - New requirements cover the backend data source's coverage, error mapping and stream recovery.

## Impact

- New code: `frontend/src/data/sources/backend/`, its tests, and `frontend/e2e/backend/`. No screen changes; the lint boundary is unchanged.
- No new frontend runtime dependencies.
- The `Backend` CI workflow gains an integration job.
- `architecture.md` → Frontend → Data layer: describes the backend data source and its delegation. No other section is affected.

## Out of Scope

- Backend support for the session (sign-in), entities, alerts and dataspace areas and the other areas still on the mock, and for escalation and conversation operations (later phases).
- Production serving of the UI with a proxy to the backend (deployment phase).
- Removing the mock source; it stays the default.
