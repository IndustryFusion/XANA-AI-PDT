# Proposal

Issue: #3

## Why

The repository has a target architecture but no user interface, and UI work should not wait for the backend. This change lays the foundation every later UI change builds on: an application shell, a data layer that runs on mock data today and accepts a backend adapter later without screen changes, a shared visual system, and the frontend test setup. It is the first of four changes delivering issue #3.

## What Changes

- Add a React 18 + Vite frontend in `frontend/` that starts with no backend.
- Application shell: sign-in screen (when authentication is enabled), header with product name, main navigation to all eight screen areas, user menu with factory details and sign-out, dataspace indicator with a reconnect hint, and a URL for every screen.
- Overview dashboard with tiles for active incidents, open alerts, data overview, dataspace and system health, each linking to its screen.
- UI data interface for all areas (session, runs, incidents, entities, alerts, dataspace, knowledge base, system health), defined in the UI's own terms. Screens obtain data only through it.
- Mock data source implementing the interface for the areas this change uses (session, dashboard summaries), with seeded data and per-area latency and failure injection. Later changes add mock data for their areas.
- Configuration that selects the data source (default: mock). The backend adapter itself is out of scope.
- Visual system: dark and light themes, accessible status presentation, keyboard operation, shared layout components, and defined loading, empty and error states.
- Placeholder screens for the areas delivered by later changes, so navigation is complete from the start.
- Frontend test and lint conventions: component tests, data-interface tests of the mock, end-to-end tests against the mock, a lint check, and a CI workflow running them.
- `architecture.md` → Frontend updated to describe the screens, the data layer and mock data source, and the run states the UI represents.

## Capabilities

### New Capabilities

- `operator-ui/app-shell`: Sign-in, navigation, addressable screens, user and factory information, dataspace indicator.
- `operator-ui/dashboard`: Overview tiles summarising incidents, alerts, data, dataspace and system health, with links to each area.
- `operator-ui/data-source`: How the UI obtains data: one replaceable data source selected by configuration, mock data with failure and latency injection, and per-area error isolation.
- `operator-ui/visual-system`: Themes, accessible status presentation, keyboard operation and the standard loading, empty and error states.

### Modified Capabilities

None.

## Impact

- New code: `frontend/` (application, mock data, tests). New CI workflow for frontend checks.
- New development dependencies only for build, test and lint; runtime dependencies are limited to the UI framework, styling and charting choices recorded in `design.md`.
- No backend, API or deployment change.
- `architecture.md` sections affected: **Components → Frontend** (component table, data flow, key files) is rewritten for the new screens and data layer; the list of run states in the frontend data flow is extended with `awaiting_confirmation`, `awaiting_recommendation_review`, `mb_closed`, `stopped` (with reopen) and archiving, which the UI represents. **Agent Runtime** and **API Layer** are not changed by this change; the backend side of these states is left to the backend issue.

## Out of Scope

- The backend and the backend adapter for the UI data interface.
- Real authentication against an identity provider (sign-in uses the mock).
- Incident workflow, incident history, data explorer, alerts, dataspace and system screens beyond placeholders (changes 2–4 of issue #3).
- Container image, Helm chart and deployment of the frontend.
- Translations; the UI is English only.
