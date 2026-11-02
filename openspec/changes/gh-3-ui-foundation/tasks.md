# Tasks

## 1. Project setup

- [ ] 1.1 Scaffold `frontend/` with Vite, React 18 and the folder structure from design decision 7; verify `npm ci` and `npm run build` succeed
- [ ] 1.2 Add Vitest (jsdom, Testing Library), Playwright with axe, and ESLint flat config with the recommended JavaScript, React and React Hooks rules; verify `npm run lint`, `npm test` and `npm run test:e2e` each run (with an initial smoke test)
- [ ] 1.3 Add the `Frontend` CI workflow (lint, unit tests, build, end-to-end) on Pull Requests touching `frontend/**`; verify it passes on this Pull Request

## 2. Visual system

- [ ] 2.1 Define design tokens for dark and light themes as CSS custom properties, theme selection by system preference with an operator override persisted locally; verify component tests for default-from-system and persisted choice (spec: visual-system → Dark and light themes)
- [ ] 2.2 Build the base components (Button, Badge with text label, Card, Table, Tabs, Dialog with focus trap and Escape, Toast, Loading/Empty/Error state views with retry); verify component tests for badge labels, dialog focus handling and retry (spec: visual-system → Readable status, Keyboard operation → Dialogs, Standard data states)
- [ ] 2.3 Implement responsive layout rules (single column below 900 px) and `prefers-reduced-motion`; verify an end-to-end test at 800 px width shows no horizontal overflow (spec: visual-system → Layout widths)

## 3. Data layer and mock source

- [ ] 3.1 Write `frontend/docs/data-interface.md` and `src/data/interface.js` documenting every area and operation from design decision 4, including the run-stream event contract and `DataError` kinds; verify every operation listed in the design appears in both
- [ ] 3.2 Implement the data facade with build-time source selection (`VITE_DATA_SOURCE`, default `mock`) and the configuration error screen for unknown values; verify component tests for default selection and the error screen (spec: data-source → Configurable data source)
- [ ] 3.3 Implement the `useData` hook (loading, data, error, retry) and per-area error isolation; verify tests showing one failing area does not affect another (spec: data-source → Error isolation)
- [ ] 3.4 Implement the deterministic seed and in-memory store mirrored to `sessionStorage` for the entities, runs, alerts, dataspace and health records the dashboard needs; verify tests that seeded references resolve across areas and survive reload (spec: data-source → Realistic mock data)
- [ ] 3.5 Implement mock operations for session (`getAuthConfig`, `getSession`, `signIn`, `signOut`, `getFactory`) and dashboard needs (`listActiveRuns`, `countAlerts`, `getStats`, `getConnection`, `listPeers`, `getHealth`); all others reject with `unavailable`; verify data-interface shape tests for each implemented operation (spec: data-source → Documented data interface)
- [ ] 3.6 Implement dev controls for per-area latency and failure and mock auth on/off, excluded from production builds; verify tests for slow and failing areas and a build test asserting the controls are absent from the production bundle (spec: data-source → Failure and latency injection)
- [ ] 3.7 Add the boundary lint rules (no `data/sources/**` imports outside `data/`; no `fetch`, `WebSocket`, `EventSource` outside `data/sources/**`); verify a deliberately violating fixture fails lint and the real code passes (spec: data-source → Single data boundary)
- [ ] 3.8 Add an end-to-end test that starts the app on the mock with request interception and asserts no requests leave the app's own origin (spec: data-source → Runs without a backend)

## 4. Application shell

- [ ] 4.1 Implement the router and route table from design decision 3 with not-found view and browser history support; verify component and end-to-end tests for open-by-URL, reload, unknown URL, back/forward (spec: app-shell → Addressable screens)
- [ ] 4.2 Implement the session gate, sign-in screen (credential and provider-unreachable errors), periodic session re-check and sign-out; verify end-to-end tests for all sign-in, expiry and sign-out scenarios with mock auth enabled and disabled (spec: app-shell → Sign-in, Session expiry, Sign-out)
- [ ] 4.3 Implement the header: product name, logo slot, navigation for the seven areas with current-area marking, user menu with factory details, dataspace indicator with reconnect hint; verify component tests for navigation marking, factory details with missing fields, and connected/expired/not-configured indicator states (spec: app-shell → Main navigation, User and factory information, Dataspace indicator)
- [ ] 4.4 Add placeholder views for incidents, history, data explorer, alerts, dataspace and system naming the change that delivers them; verify an end-to-end test visits each (spec: app-shell → Area not yet delivered)
- [ ] 4.5 Implement the shared entity-reference element with its actions (open in explorer, start incident with prefill, show active incidents, show history); verify component tests for prefill and navigation targets (spec: app-shell → Cross-navigation from entity references)

## 5. Dashboard

- [ ] 5.1 Implement the five tiles with independent loading, empty and error states and links to areas and items; verify component tests per tile including one failing area, empty incidents with call to action, and dataspace not connected (spec: dashboard → Overview tiles, Tiles link to their areas, Independent tile states)
- [ ] 5.2 Implement the refresh interval selector with off option, persisted locally; verify tests with fake timers for interval and off (spec: dashboard → Refresh)

## 6. Documentation

- [ ] 6.1 Update `architecture.md` → Components → Frontend per design decision 10; verify the section lists all eight areas, the data layer, mock source and the run states from the proposal
- [ ] 6.2 Add `frontend/README.md` (run, test, lint, data-source setting, dev controls); verify each documented command runs as written

## 7. Integration checks

- [ ] 7.1 Run the accessibility end-to-end suite on every route in both themes; verify zero axe violations and keyboard-only sign-in and navigation (spec: visual-system → Contrast, Keyboard operation)
- [ ] 7.2 Run `openspec validate gh-3-ui-foundation --strict` and the full frontend CI locally; verify both pass and record per-scenario verification results in the Pull Request

## Workflow follow-up

- A maintainer adds the `spec-approved` label before any task above starts.
- After merge, archive with `/opsx:archive gh-3-ui-foundation` in a follow-up Pull Request; verify `openspec/specs/operator-ui/` contains the four capabilities.
