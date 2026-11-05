# XANA AI PDT — Operator UI

React 18 + Vite frontend for XANA AI PDT. It runs completely on built-in mock data; a backend can be attached later through the UI data interface without changing any screen. See [`architecture.md`](../architecture.md) → Frontend and [`docs/data-interface.md`](docs/data-interface.md).

## Requirements

Node.js 22 or later.

## Run

```bash
npm ci
npm run dev
```

The development server listens on all network interfaces (port 5173, or the next free port), so it can be opened from another machine at `http://<host-ip>:5173`; `npm run preview` does the same on port 4173. Use `npm run dev -- --port <port>` to pick a port. With the mock data source, sign in as `operator` / `operator`.

## With the backend

The development server forwards `/api` and `/ws` to the backend at `XANA_BACKEND_URL` (default `http://localhost:8000`, the local environment in [`../backend`](../backend/README.md)), for example `XANA_BACKEND_URL=http://localhost:18000 npm run dev`.

`backend/sample_data/sample-data.json` is exported from the mock seed, so the backend's sample machines are the mock's. After changing the seed, run `npx vite-node scripts/export-sample-data.mjs`; a unit test fails while the two differ.

## Commands

| Command | What it does |
|---|---|
| `npm run dev` | Development server with mock data and the mock data controls |
| `npm run build` | Production build in `dist/` |
| `npm run preview` | Serves the production build |
| `npm run lint` | ESLint, including the data-boundary rules |
| `npm test` | Unit, component and data-interface tests (Vitest) |
| `npm run test:bundle` | Checks that the production build contains no development-only controls and loads the chart library only on demand (run after `build`) |
| `npm run test:e2e` | End-to-end and accessibility tests (Playwright); starts the dev server itself |

The first end-to-end run needs a browser: `npx playwright install chromium`.

## Data source

The data source is chosen at build time with `VITE_DATA_SOURCE`:

| Value | Data source |
|---|---|
| `mock` (default) | Deterministic mock data in the browser; no backend needed |
| `backend` | Runs, incident history and system health from the backend; every other area from the mock data |

An unknown value shows a configuration error naming the setting and the accepted values.

**On the backend:** start the backend (`backend/README.md`, for example the local environment with `LLM_PROVIDER=scripted`), then `VITE_DATA_SOURCE=backend npm run dev`. The development server forwards `/api` and `/ws` to `XANA_BACKEND_URL` (default `http://localhost:8000`). Which operations the backend serves is listed in [`docs/data-interface.md`](docs/data-interface.md#backend-source).

**End-to-end tests on the backend:** with the local environment running on the scripted model, `npm run test:e2e:backend` runs `e2e/backend/` against it (`XANA_BACKEND_URL` to point elsewhere). `npm run test:e2e` keeps running the mock tests only. To refresh the recorded backend answers used by the unit tests: `node scripts/record-backend-fixtures.mjs` (`BACKEND_URL`, default `http://localhost:8000`).

`VITE_SESSION_CHECK_MS` (optional) overrides how often the session is re-checked (default 60000 ms); the end-to-end tests use it to exercise session expiry.

## Mock data controls

In development builds a **Mock data controls** button (bottom left) opens a panel to:

- add latency or force a failure per interface area, to see loading and error states;
- switch sign-in on or off, or expire the current session;
- set the dataspace connection state, make the dataspace gateway unreachable, or let the configuration provide the dataspace credential;
- choose the **scenario** of the next started run and the **playback speed** of simulated runs;
- interrupt and restore the live connection of an open run, to see the run view reconnect;
- make live entity updates in the data explorer unavailable;
- switch off the occasional new alerts raised while the Alerts area is open;
- reset the mock data to its seed.

### Simulated runs

A run engine in the mock plays the agent workflow with realistic delays (divided by the playback speed) and a simulated machine builder that answers escalations and acts. Started runs follow the scenario chosen in the controls (default: happy path):

| Scenario | Operator actions | Run states |
|---|---|---|
| Happy path | Confirm | running → awaiting_confirmation → running → completed |
| Low confidence | Clarify, confirm | running → awaiting_input → running → awaiting_confirmation → running → completed |
| Rejected resolution | Reject with reason, confirm | running → awaiting_confirmation → running → awaiting_confirmation → running → completed |
| Escalation within tier | Escalate, send a request | running → awaiting_input → awaiting_machine_builder |
| Request beyond tier | Escalate, approve or decline | … → awaiting_machine_builder → awaiting_operator_approval → awaiting_machine_builder |
| Machine-builder recommendation | Escalate, answer "resolved" | … → awaiting_machine_builder → awaiting_recommendation_review → completed |
| Machine builder closes | Escalate, check status | … → awaiting_machine_builder → mb_closed |
| Stop and reopen | Escalate, stop, reopen | … → awaiting_machine_builder → stopped → awaiting_machine_builder |
| Direct contact | Escalate, ask for direct contact, close as escalated | … → awaiting_machine_builder → stopped (not reopenable) |
| Failure | — | running → failed |
| Degraded data | Confirm | running (time-series database unavailable) → awaiting_confirmation → running → completed |

The seeded open runs and the twelve past incidents are produced by the same engine. The scenarios are defined as data in `src/data/sources/mock/scenarios/`.

### Entities and alerts

The mock entities are NGSI-LD entities of one factory (lines, machines, components, sensors) with every attribute kind: properties with units, observation times and sub-attributes, relationships, IRI values, geo, JSON, language, list and vocabulary properties. Sensor values and machine states have a deterministic history over the 7 days before the mock data was created, which also drives time-shift and live updates (every 5 s divided by the playback speed). Importing from a URL works with the sample documents listed in [`docs/data-interface.md`](docs/data-interface.md); the mock makes no network requests. Sixteen seeded alerts in two environments reference the factory's machines.

### Dataspace, system and knowledge base

The factory is connected to the dataspace with the data-sharing tier `minimal`; after disconnecting, connect again with the credential `plant-north-secret` (shown as a hint below the form). Four machine builders are compatible peers, with seeded policies and five capability requests. The System area checks eight dependencies; a saved service address under the reserved `.invalid` domain does not answer, to show a failing dependency. The knowledge base holds sample manuals in both ingestion pipelines; uploads are ingested in a few seconds (divided by the playback speed), Markdown files are searchable by their sections, and a file whose name contains `corrupt` fails. Details in [`docs/data-interface.md`](docs/data-interface.md).

Settings are stored in `localStorage` (`xana.mock.controls`); operator changes to mock data live in `sessionStorage` for the current tab. Production builds do not contain the controls.

## Structure

```
src/
  app/        shell: router, session gate, sign-in, header, entity references, not-found and configuration error
  ui/         design tokens, themes and shared components
  data/       UI data interface, facade, mock and backend data sources
  features/   one folder per area (dashboard, incidents, history, explorer, alerts, dataspace, system)
tests/        Vitest tests, mirroring src/
e2e/          Playwright tests
docs/         data-interface.md
```

Runtime dependencies: `react`, `react-dom`, and `recharts` for attribute-history charts in the data explorer (loaded on demand, not part of the other areas' code).

Rules enforced by lint: screens import data only from `src/data` (never from `src/data/sources/`), and only data sources may use `fetch`, `WebSocket`, `EventSource` or `XMLHttpRequest`.
