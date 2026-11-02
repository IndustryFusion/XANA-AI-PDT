# XANA AI PDT — Operator UI

React 18 + Vite frontend for XANA AI PDT. It runs completely on built-in mock data; a backend can be attached later through the UI data interface without changing any screen. See [`architecture.md`](../architecture.md) → Frontend and [`docs/data-interface.md`](docs/data-interface.md).

## Requirements

Node.js 22 or later.

## Run

```bash
npm ci
npm run dev
```

Open the printed URL. With the mock data source, sign in as `operator` / `operator`.

## Commands

| Command | What it does |
|---|---|
| `npm run dev` | Development server with mock data and the mock data controls |
| `npm run build` | Production build in `dist/` |
| `npm run preview` | Serves the production build |
| `npm run lint` | ESLint, including the data-boundary rules |
| `npm test` | Unit, component and data-interface tests (Vitest) |
| `npm run test:bundle` | Checks that the production build contains no development-only controls (run after `build`) |
| `npm run test:e2e` | End-to-end and accessibility tests (Playwright); starts the dev server itself |

The first end-to-end run needs a browser: `npx playwright install chromium`.

## Data source

The data source is chosen at build time with `VITE_DATA_SOURCE`:

| Value | Data source |
|---|---|
| `mock` (default) | Deterministic mock data in the browser; no backend needed |

An unknown value shows a configuration error naming the setting and the accepted values. A backend adapter is added as another source under `src/data/sources/` that implements every operation in `src/data/interface.js` and passes `tests/data/interface.test.js`.

`VITE_SESSION_CHECK_MS` (optional) overrides how often the session is re-checked (default 60000 ms); the end-to-end tests use it to exercise session expiry.

## Mock data controls

In development builds a **Mock data controls** button (bottom left) opens a panel to:

- add latency or force a failure per interface area, to see loading and error states;
- switch sign-in on or off, or expire the current session;
- set the dataspace connection state;
- reset the mock data to its seed.

Settings are stored in `localStorage` (`xana.mock.controls`); operator changes to mock data live in `sessionStorage` for the current tab. Production builds do not contain the controls.

## Structure

```
src/
  app/        shell: router, session gate, sign-in, header, entity references, placeholders
  ui/         design tokens, themes and shared components
  data/       UI data interface, facade, mock data source
  features/   one folder per area (dashboard so far)
tests/        Vitest tests, mirroring src/
e2e/          Playwright tests
docs/         data-interface.md
```

Rules enforced by lint: screens import data only from `src/data` (never from `src/data/sources/`), and only data sources may use `fetch`, `WebSocket`, `EventSource` or `XMLHttpRequest`.
