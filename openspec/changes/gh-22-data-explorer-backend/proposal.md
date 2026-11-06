# Proposal

Issue: #22

## Why

The Data Explorer runs only on the UI's mock. Operators need to query, edit and import the real digital twin, read its history and see it as it was at a past moment. The agent's history source also ignores relationship and text changes and entity lifecycle, and it skips history rows whose `deleted` value is null.

## What Changes

- Add backend routes under `/api/ngsi`, using the backend's own configuration only: `entities`, `types`, `stats`, `attributes`, editing through Scorpio, `delete-by-types`, `import`, `import/fetch`, `history`, `attr-status`, `timeshift/types` and `timeshift/entities`.
- Serve the `entities` area from the backend data source. Live updates (#23) and value hints (#24) stay on the mock until those issues.
- Add the settings `PGREST_URL`, `NGSI_CONTEXT_URL` and `TIMESCALE_ENTITY_TABLE`.
- Report an unreachable or failing Scorpio or PostgREST as `unavailable` with HTTP 502.
- Extend the agent's history source with relationship and text changes and lifecycle reads from `entities`, and include rows where `deleted` is null. The diagnostic workflow stays read-only.
- Add PostgREST to the local environment under a profile, and move the sample history table to the platform's layout, with an `entities` table.

## Capabilities

### New Capabilities

- `backend/explorer-api`: Query, edit, import, history and time-shift routes for the Data Explorer.

### Modified Capabilities

- `backend/diagnostic-workflow`: Observe also reads changes and lifecycle; history includes rows where `deleted` is null.
- `backend/local-environment`: Optional PostgREST, and the sample tables in the platform's layout.
- `backend/run-api`: Error kinds may answer 502 for a service behind the backend.
- `operator-ui/data-source`: The backend source serves the explorer's operations.
- `operator-ui/data-explorer`: The latest recorded state of an attribute, and errors of the services behind the explorer.

## Impact

- `backend/`: new `app/ngsi/`, `app/api/ngsi.py`; changes in `app/config.py`, `app/errors.py`, `app/main.py`, `agent/xana_agent/sources/`, `agent/xana_agent/steps/observe.py`, `sample_data/`, `compose.yaml`, `keycloak/`, `.env.example`, `README.md`.
- `frontend/`: new `src/data/sources/backend/entities.js`; changes in `http.js`, `index.js`, the interface, the mock's `entities` area, `HistoryPane.jsx`, `docs/data-interface.md`.
- `helm/`: settings for PostgREST and the context.
- `architecture.md`: Data explorer in the frontend and backend sections, Key Variable Groups.

## Out of Scope

- Live updates (#23), value hints from Fuseki (#24), alerts (#25) and anything from #26 onward.
- Editing by the agent: editing is an operator action only.
- Per-operator sessions and protecting the backend's API, which #36 redesigns.
- Changes to the digital twin platform.
