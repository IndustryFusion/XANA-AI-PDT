# Tasks

## 1. Backend

- [x] 1.1 Add `ContextAllowList` with the core, built-in, deployment and added contexts, entries ending in `/` allowing what is below them (D1); verify with backend tests for each source, an entry below and a look-alike host
  - `backend/tests/test_contexts.py`, *core, built-in and deployment contexts are allowed* (an entry below, a look-alike host, an internal one), *dot segments don't reach past an entry*.
- [x] 1.2 Keep added contexts in the table `allowed_contexts`, read at most every 30 seconds, and the last read ones in force when it can't be read (D2); verify with backend tests for adding, removing, a failing store and a backend without one
  - *added contexts are allowed, listed and removed* (with who added them), *a database that fails* (the others still apply, the list says so), *a read that overlaps a removal doesn't bring it back*, and *without a database the list is not editable*.
- [x] 1.3 Add the routes to list, check, add and remove, and only take plain http(s) URLs (D3); verify with backend tests for each route, the refused URLs and the risks
  - *the routes list, check, add and remove*, *only plain http URLs can be added* (another scheme, no host, credentials, spaces, over 2000 characters), *a url with a port that isn't one is refused*, *the risks of a context* (none, plain http, internal, unresolvable).
- [x] 1.4 Refuse an import's context against the list, naming it only when it looks external (D4); verify with backend tests for an IFF context, an external one named and internal ones not named
  - `test_explorer_broker.py`: *an IFF context is allowed on import and an external refused one is named*, *import never passes on a context that is not allowed* (internal addresses not in the reason); `test_contexts.py`, *only external-looking contexts are named* and *a root dot doesn't hide an internal host*; *a context that can never be allowed has a reason of its own*.

## 2. System area

- [x] 2.1 Add the card *Allowed contexts* with the list, adding after the dialog and removing after confirming; verify with unit tests for the list, a plain-http address, an address without risks, no URL and removing
  - `frontend/tests/system/system.test.jsx`, *allowed contexts*: the list with sources, a plain-http context warned and allowed anyway, an https one with the general warning only, no URL, and removing.
- [x] 2.2 Serve the four operations in both data sources, documented; verify with the data-source tests and the shape tests on recorded backend answers
  - `tests/data/interface.test.js` (documented and mock shapes), `backendSource.test.js` (operations served) and `backendShapes.test.js` on answers recorded from a local platform's backend.

## 3. Checks

- [x] 3.1 Run the backend and frontend suites, the build, the bundle check and the end-to-end tests; verify they pass
  - Backend: ruff, the tests and the agent tests. Frontend: eslint, the unit tests, the build, the bundle check and 173 end-to-end tests.
- [x] 3.2 On the local platform, add and remove a context, ask for the risks of a plain-http one, and import entities with an IFF context and with a context that isn't allowed; verify the list, the risks and the reasons
  - On a local IFF platform: the list showed the core and built-in entries and was editable; a test context was added and removed; the risks of a plain-http address named it; an entity with `https://industryfusion.github.io/contexts/staging/opcua/v0.2/context.jsonld` was imported (and deleted again); one with `https://example.net/other.jsonld` was refused naming it, and one with `http://fuseki.local/c.jsonld` without naming it.
