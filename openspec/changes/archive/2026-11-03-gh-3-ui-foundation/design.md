# Design

## Context

See proposal.md → Why. The repository contains documentation and OpenSpec only; `frontend/` does not exist yet. `architecture.md` → Components → Frontend describes a React 18 + Vite single-page app with JavaScript modules (`src/hooks/useWebSocket.js`, `src/api/client.js`) and a theme built from CSS variables without a CSS framework. `openspec/config.yaml` defines no frontend test or lint conventions; this change defines them. Issue #3 fixes the delivery order: this change provides the frame and data layer that changes 2–4 fill in.

## Goals / Non-Goals

**Goals:**
- A data boundary that a backend adapter can implement later without touching screens.
- Mock data that is deterministic, consistent across areas and controllable (latency, failure).
- Conventions (structure, tests, lint, CI) that later changes follow without new decisions.

**Non-Goals:**
- Mock data and screens for incidents, history, data explorer, alerts, dataspace and system; only what the shell and dashboard need is implemented here.
- Server-side configuration for history-mode URLs in deployment (no deployment in this issue).

## Decisions

### 1. JavaScript with documented types
JavaScript (ES modules) with JSDoc type annotations on the data interface. Matches `architecture.md`, keeps the contributor barrier low, and still lets editors check the interface.
*Alternatives:* TypeScript gives stronger interface checking but adds a compile step and deviates from `architecture.md` without a request to change it.

### 2. Styling with CSS custom properties, no CSS framework
Design tokens (colours, spacing, radii, typography, status colours) as CSS custom properties, with one token set per theme selected by a `data-theme` attribute on the root, defaulting to the `prefers-color-scheme` media query. Component styles in plain CSS files next to their components. The dark theme is the primary, industrial look (deep blue-grey surfaces, indigo accent); the light theme mirrors it.
*Alternatives:* a utility CSS framework speeds up layout but contradicts `architecture.md` ("no framework") and spreads styling across markup; CSS-in-JS adds a runtime dependency.

### 3. Routing with the History API, small in-house router
A route table maps paths to areas and item IDs (`/`, `/incidents`, `/incidents/:runId`, `/history`, `/history/:incidentId`, `/explorer`, `/explorer/:entityId`, `/alerts`, `/alerts/:alertId`, `/dataspace`, `/system`, `/signin`). A small router listens to `popstate`, exposes the current route through context, and renders a not-found view for unknown paths. The Vite dev server already falls back to `index.html`.
*Alternatives:* a routing library is well known but brings more features and weight than a flat table of about a dozen routes needs; hash URLs need no server fallback but are harder to read and share.

### 4. Data layer: one facade, interchangeable sources
```
frontend/src/data/
  index.js            facade: exports the area modules of the selected source
  interface.js        JSDoc typedefs of all shapes and operations
  errors.js           DataError (area, kind, message)
  sources/mock/       mock source: seed, in-memory store, areas, dev controls
docs/data-interface.md  per-area documentation (operations, inputs, results, errors)
```
- Every operation is an async function returning a promise. Live data uses `subscribe…(params, onEvent) → unsubscribe`. Errors reject with a `DataError` whose `kind` is one of `unavailable`, `not_found`, `conflict`, `invalid`, `unauthorized`.
- Areas and operations (names follow `architecture.md` where it names them):
  - **session**: `getAuthConfig`, `getSession`, `signIn`, `signOut`, `getFactory`
  - **runs**: `listActiveRuns`, `startRun`, `getRun`, `subscribeRun`, `clarify`, `confirmResolution`, `escalationPreflight`, `escalate`, `approveDataRequest`, `replyToRecommendation`, `sendConversationAct`, `askAgent`, `getOutboxStatus`, `refreshConversationStatus`, `recordMachineBuilderClose`, `reopenRun`, `stopRun`, `archiveRun`
  - **incidents**: `listIncidents`, `getIncident`, `reopenIncident`
  - **entities**: `getStats`, `listTypes`, `listAttributes`, `queryEntities`, `getEntity`, `updateAttributes`, `appendAttributes`, `deleteAttribute`, `deleteEntity`, `importEntities`, `fetchImportDocument`, `deleteByTypes`, `getAttributeHistory`, `listTypesAt`, `queryEntitiesAt`, `subscribeEntities`, `getLiveUpdateHealth`, `getValueHints`
  - **alerts**: `listAlerts`, `countAlerts`, `getAlert`, `applyAlertAction`, `listEnvironments`, `listServices`
  - **dataspace**: `getConnection`, `connect`, `disconnect`, `listPeers`, `getPeerCapabilities`, `listCapabilityRequests`, `decideCapabilityRequest`, `setCapabilityPolicy`, `resolveNames`, `resolveBuilders`
  - **knowledgeBase**: `listDocuments`, `uploadDocument`, `getIngestJob`, `updateDescription`, `deleteDocument`, `query`
  - **system**: `getHealth`, `getServiceSettings`, `saveServiceSettings`
- The run stream contract for `subscribeRun` is fixed here so the backend adapter can implement it: the first event is the run's current state; then `step` events (`node`, structured output) and `status` events (`status`, state data) follow; reconnect and status polling are the source's job, invisible to screens.
- This change implements in the mock: all of **session**, plus `listActiveRuns`, `countAlerts`, `getStats`, `getConnection`, `listPeers`, `getHealth` for the dashboard. Other operations reject with `unavailable` until their change implements them.
- Selection: build-time setting `VITE_DATA_SOURCE` (default `mock`). An unknown value renders the configuration error screen (spec: data-source).
*Alternatives:* mocking at the network level (request interception) would require the backend's HTTP contract now, which this issue leaves to the backend issue, and would contradict "no network requests" on the mock; a data-fetching/caching library adds a dependency where a small `useData(area, op, args)` hook with loading/error/retry state suffices for now.

### 5. Mock data source
- Deterministic seed (fixed pseudo-random seed) producing one factory with a handful of production lines, machines and components as NGSI-LD-style entities with relationships, signal series, alerts that reference those machines, past incidents, dataspace peers and knowledge-base documents. Areas added by later changes extend the same seed so references stay consistent.
- An in-memory store holds operator changes and is mirrored to `sessionStorage`, so a reload keeps the session's changes and a new tab starts from the seed.
- Dev controls (development builds only, excluded from production by a build-time flag): per-area latency and failure mode, and mock auth enabled/disabled. Later, change 2 adds scenario selection and playback speed here.
*Alternatives:* random data per load makes tests and screenshots unstable; static JSON fixtures cannot express live behaviour or operator changes.

### 6. Application state
React context for session, theme and route; local component state and the `useData` hook for everything else.
*Alternatives:* a global state library is unnecessary at this size and can be added later behind the same hooks.

### 7. Folder structure
```
frontend/
  index.html, vite.config.js, package.json, eslint.config.js, playwright.config.js
  src/
    main.jsx, App.jsx
    app/         shell, router, session gate, header, navigation, not-found, config error
    ui/          design-system components (Button, Badge, Card, Table, Tabs, Dialog, Toast, StateViews…) and tokens.css
    data/        see decision 4
    features/    dashboard/ (this change); incidents/, history/, explorer/, alerts/, dataspace/, system/ (placeholders now)
  tests/         unit and component tests mirror src/
  e2e/           end-to-end tests
  docs/          data-interface.md
```
*Alternatives:* grouping by file type (components/, hooks/) scatters a feature across folders as it grows.

### 8. Tests, lint and CI
- **Component and data-interface tests:** Vitest with Testing Library in a jsdom environment. Each implemented interface operation has a test checking its result shape against the JSDoc typedefs via a small runtime shape checker shared with future adapters.
- **End-to-end:** Playwright (Chromium) against the Vite dev server on the mock source; accessibility checks (contrast, roles, focus) with axe on every area in both themes.
- **Lint:** ESLint flat config with the recommended JavaScript, React and React Hooks rules, plus the boundary rules: `no-restricted-imports` forbids importing `data/sources/**` outside `data/`, and `no-restricted-globals` forbids `fetch`, `WebSocket` and `EventSource` outside `data/sources/**`.
- **CI:** a `Frontend` workflow on Pull Requests touching `frontend/**`: `npm ci`, lint, unit tests, build, end-to-end tests. Node.js 22 LTS.
*Alternatives:* Jest needs extra configuration for Vite and ES modules; Cypress is heavier to run in CI than Playwright; skipping axe would leave the contrast requirement unchecked.

### 9. Dependencies
Runtime: `react`, `react-dom`. Development: `vite`, `@vitejs/plugin-react`, `vitest`, `@testing-library/react`, `@testing-library/user-event`, `@testing-library/jest-dom`, `jsdom`, `@playwright/test`, `@axe-core/playwright`, `eslint` with React and React Hooks plugins. Charting (for later changes) is decided in change 3.
*Alternatives:* see decisions 2–4 and 8.

### 10. `architecture.md` update
Rewrite **Components → Frontend**: the eight areas instead of three panels, the data layer and mock source, the routing, the run states the UI represents (adding `awaiting_confirmation`, `awaiting_recommendation_review`, `mb_closed`, `stopped` with reopen, archiving), and updated key files. The data-flow description keeps REST and WebSocket as the way a backend adapter will talk to the backend. **Agent Runtime** and **API Layer** stay unchanged; their counterparts for the new states belong to the backend issue.
*Alternatives:* leaving `architecture.md` unchanged would leave documented states and the implemented UI out of sync; changing the backend sections now would specify the backend in a UI issue.

## Conflicts with `architecture.md` and existing specs

- `architecture.md` describes the frontend as three panels without routing and lists fewer run states than the UI represents. Resolved by decision 10 (documentation update in this change).
- `architecture.md` documents a single RETRIEVE step; the run-stream contract in decision 4 accepts any step `node` value, so the UI does not depend on how retrieval is split. No conflict for this change; the incident-workflow change will present retrieval steps generically.
- No existing specs in `openspec/specs/`.

## Risks / Trade-offs

- [The mock and a future backend drift apart] → The interface is documented in one place and the shape tests are written so a backend adapter must pass the same tests.
- [In-house router lacks features later needed] → The route table and router are isolated in `app/`; swapping to a library later does not affect features.
- [Dev controls leak into production] → Excluded by a build-time flag; a test asserts they are absent from the production bundle.
- [Accessibility checks are flaky with animations] → Animations respect `prefers-reduced-motion`, which the end-to-end tests enable.
- [Placeholder areas look unfinished in review] → Placeholders clearly state which change delivers the area.
