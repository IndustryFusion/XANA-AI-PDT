# Tasks

## 1. Backend data source

- [ ] 1.1 Add `sources/backend/` with the HTTP wrapper, case mapping and error mapping, and register `backend` in the facade; verify unit tests for case mapping both ways, each error kind, and a network failure (spec: data-source → Backend errors in interface terms → Conflict)
- [ ] 1.2 Implement the runs, incidents and system operations, and the delegation to the mock; verify unit tests per operation with a fake `fetch`, and a test that the mock serves the delegated operations (spec: data-source → Configurable data source, Backend data source coverage)
- [ ] 1.3 Implement `subscribeRun` with reconnect and an unknown-run stop; verify tests with a fake `WebSocket` and fake timers for snapshot first, drop and recovery, and run gone (spec: data-source → Run stream recovery)
- [ ] 1.4 Record backend fixtures with a script against the local backend, and run the interface shape tests against the backend source; verify that the shape tests pass (spec: data-source → Backend data source coverage → Shapes checked)

## 2. End-to-end and CI

- [ ] 2.1 Add the Playwright `backend` project and the `e2e/backend/` tests for start through history, rejection, clarification, escalation not offered, and backend stopped; verify that they pass against the local environment with the scripted provider (spec: data-source → Backend data source coverage, Backend errors in interface terms → Backend stopped)
- [ ] 2.2 Add the `integration` job to the `Backend` workflow; verify that it passes on this pull request
- [ ] 2.3 Run the full frontend suite on the mock source; verify that lint, unit tests, build, bundle check and end-to-end tests are unchanged and pass (spec: data-source → Configurable data source → Default configuration)

## 3. Manual check with a real model

- [ ] 3.1 With the local environment and Ollama, start an incident from the UI and go through clarification or rejection, confirmation, archive and history; verify by recording the result and the model used in the pull request

## 4. Documentation

- [ ] 4.1 Update `frontend/docs/data-interface.md` (backend source, served operations, delegation) and `architecture.md` → Frontend → Data layer; verify that they match design decision 1
- [ ] 4.2 Run `openspec validate gh-12-ui-backend-source --strict`; verify that it passes
