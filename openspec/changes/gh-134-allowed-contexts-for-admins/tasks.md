# Tasks

## 1. Backend

- [x] 1.1 Read the signed-in operator's roles on the platform's client from the session's own token (D1); verify with backend tests for a token with the role, without it, on another client, and malformed claims
  - `backend/tests/test_auth.py`, *the operator's roles on the platform's client* (none before sign-in and after sign-out) and *no roles without them on the client* (no claim, another client, malformed roles).
- [x] 1.2 Refuse adding, removing and the risks check without `Factory-Admin` as `unauthorized` with HTTP 403, naming the role, and refuse them without sign-in (D2–D5); verify with backend tests for each operation, `Factory-Reader`, `Factory-Writer`, no role, and an admin
  - `backend/tests/test_contexts.py`, *only a factory admin may change the list* (no role, `Factory-Reader`, `Factory-Writer`, a role in another case: adding, removing and the risks refused with 403 naming the role, nothing stored or removed) and *the routes list, check, add and remove* as an admin; without sign-in the session has no roles (`test_auth.py`).
- [x] 1.3 Say in the list whether the operator may change it and which role may (D7); verify with backend tests for both cases
  - *only a factory admin may change the list* (`mayChange` false, `changeRole`) and *a factory admin may change the list* (adding and removing answer with the list as asked for, `changeRole` with the client).
- [x] 1.4 Say in the import's refusal that an operator with `Factory-Admin` can allow the context in the System area; verify with backend tests for a named and an unnamed refused context
  - `backend/tests/test_explorer_broker.py`: *an IFF context is allowed on import and an external refused one is named* (names the role) and *import never passes on a context that is not allowed* (an unnamed one names the role, one that can never be allowed doesn't).
- [x] 1.5 Build in the well-known contexts with their labels, leaving out redirect services (D6); verify with backend tests for each entry, look-alikes, `w3id.org` and `purl.org`, and the labels in the list
  - `test_contexts.py`, *well-known contexts are built in* (one URL per entry), *redirect services and look-alikes are not built in* (`w3id.org`, `purl.org`, a look-alike host, another credentials version, another GitHub owner, a fork's commit and a pull request's head below the Smart Data Models owner, another of its repositories), *built-in contexts are listed with what they are*.
- [x] 1.6 End to end: sign in through the backend at a real Keycloak as an operator with `Factory-Admin` and as one without, and add and remove a context in the real memory database; verify with a services test run in CI
  - `backend/tests/test_contexts_real.py`, run in the services job against Keycloak's local realm and the memory database: `visitor` sees the list and is refused; `operator` adds and removes a context, which applies and then doesn't; signing in as the other changes `mayChange`. Fails without the change.

## 2. System area and data sources

- [x] 2.1 Show the list read-only without the role, saying which role may change it, and each built-in context with its label (D7); verify with unit tests for both cases
  - `frontend/tests/system/system.test.jsx`, *allowed contexts*: *lists each allowed context with where it comes from* ("Built in: IndustryFusion", "Built in: schema.org") *an operator without the admin role sees the list read-only and who may change it*, *with sign-in off, nobody may change the list* and *without a memory database, the list says so whatever the role*.
- [x] 2.2 Add `mayChange`, `changeRole` and `label` to the documented shape in both sources, and the mock's development control that refuses as the backend does; verify with the data-source tests, the shape tests on recorded backend answers, and a 403 received as `unauthorized`
  - `tests/data/interface.test.js` (documented and mock shapes), `backendShapes.test.js` on the recorded answers, `backendSource.test.js`, *a change refused for the role arrives as unauthorized*, and `system.test.jsx`, *the mock refuses changes from an operator without the admin role*.
- [x] 2.3 End to end on the mock source: an admin adds a context, and without the role the list is read-only; verify with a browser test
  - `frontend/e2e/system.spec.js`, *allowed contexts: a signed-in admin adds one; without the role or sign-in the list is read-only*.

## 3. Checks

- [x] 3.1 Run the backend and frontend suites, the build, the bundle check and the end-to-end tests, and measure the coverage of the changed code; verify they pass and the coverage is above 80 %
  - Backend: ruff, 1258 tests and 134 agent tests. Frontend: eslint, 982 unit tests, the build, the bundle check and 174 end-to-end tests. Coverage of the changed statements: backend 51 of 51, frontend 61 of 61 (100 %).
- [x] 3.2 On a local IFF platform, sign in as an operator with `Factory-Admin` and as one with `Factory-Reader` only; verify the admin adds and removes a context, the other sees the list read-only and is refused with 403, and the built-in contexts are listed with their labels
  - On a local IFF platform: as an operator with `Factory-Admin`, a context was added and removed; as one with `Factory-Reader` only, the list was read-only and said which role may change it; with nobody signed in, adding was refused with 403 naming the role; the ten entries were listed with their labels.
