# Tasks

## 1. Backend

- [ ] 1.1 Add `ContextAllowList` with the core, built-in, deployment and added contexts, entries ending in `/` allowing what is below them (D1); verify with backend tests for each source, an entry below and a look-alike host
- [ ] 1.2 Keep added contexts in the table `allowed_contexts`, read at most every 30 seconds, and the last read ones in force when it can't be read (D2); verify with backend tests for adding, removing, a failing store and a backend without one
- [ ] 1.3 Add the routes to list, check, add and remove, and only take plain http(s) URLs (D3); verify with backend tests for each route, the refused URLs and the risks
- [ ] 1.4 Refuse an import's context against the list, naming it only when it looks external (D4); verify with backend tests for an IFF context, an external one named and internal ones not named

## 2. System area

- [ ] 2.1 Add the card *Allowed contexts* with the list, adding after the dialog and removing after confirming; verify with unit tests for the list, a plain-http address, an address without risks, no URL and removing
- [ ] 2.2 Serve the four operations in both data sources, documented; verify with the data-source tests and the shape tests on recorded backend answers

## 3. Checks

- [ ] 3.1 Run the backend and frontend suites, the build, the bundle check and the end-to-end tests; verify they pass
- [ ] 3.2 On the local platform, add and remove a context, ask for the risks of a plain-http one, and import entities with an IFF context and with a context that isn't allowed; verify the list, the risks and the reasons
