# Tasks

## 1. Backend

- [x] 1.1 Add the settings `PGREST_URL`, `NGSI_CONTEXT_URL`, `TIMESCALE_ENTITY_TABLE`; verify with config tests, and that `.env.example` lists them
- [x] 1.2 Add 502 for services behind the backend, and error mapping; verify with tests for each status and for an unreachable service
- [x] 1.3 Add the `q` parser; verify syntax errors with positions and every documented operator, against the UI mock's test cases
- [x] 1.4 Add query and browse routes, including `Link` and the IRI fallback; verify with stub tests and a real broker with IRI attributes
- [x] 1.5 Add editing routes as decision 2 says; verify against a real broker that units, sub-attributes and other datasets stay
- [x] 1.6 Add `import` with 207, and `delete-by-types`; verify against a real broker with a partial failure
- [x] 1.7 Add `import/fetch`; verify every internal address form is refused, including after a redirect and a second DNS answer
- [x] 1.8 Add `history` and `attr-status`; verify against a real PostgREST on the platform's layout, and that a value can't change a filter
- [x] 1.9 Add `timeshift/types` and `timeshift/entities`; verify against the platform's layout, with kinds, datasets, sub-attributes and deletions
- [x] 1.10 Extend the agent's history source and observe; verify rows with null `deleted`, relationship and text changes, lifecycle, and a failing read
- [x] 1.11 Check tokens stay out of logs and answers; verify with a test over edits and history

## 2. Frontend

- [x] 2.1 Serve the `entities` operations from the backend source, without key mapping; verify with source tests and fixtures recorded from a real backend
- [x] 2.2 Add `getAttributeStatus` to the interface and the mock, and show a deleted attribute in the history; verify with interface and component tests
- [x] 2.3 Show errors of Scorpio and PostgREST clearly; verify in a browser with each stopped

## 3. Local environment and deployment

- [x] 3.1 Add PostgREST under a profile, and sample tables in the platform's layout; verify history through it, also with an existing volume
- [x] 3.2 Add the `role` claim to the local realm; verify PostgREST accepts the operator's token without an anonymous role
- [x] 3.3 Add the settings to the chart; verify with `helm template` and the `Deployment` workflow

## 4. Verification

- [x] 4.1 All explorer operations work on the backend source; verify in a browser test against real services
- [x] 4.2 Editing, deleting and importing against a real broker; verify with a test run against it
- [x] 4.3 History and time-shift against the platform's layout; verify with the same test
- [x] 4.4 Scorpio or PostgREST stopped gives 502 and a clear message; verify in the API and in a browser
- [x] 4.5 The agent has no write path; verify the workflow test still sees only reads

## 5. Documents

- [x] 5.1 Update `backend/README.md`, `helm/README.md`, `frontend/docs/data-interface.md`, `architecture.md`; verify by searching for each setting

## 6. Integration check

- [x] 6.1 Run backend and frontend tests, lint and `openspec validate --all --strict`; verify locally and in CI
- [x] 6.2 Check each scenario in the delta specs and report per scenario in the Pull Request

## 7. Review follow-ups

- [x] 7.1 Make every documented `q` operator work on a real broker, and malformed expressions client errors; verify with a test per operator against a real broker
- [x] 7.2 Keep remote contexts from the broker, as decision 11 says; verify on import, on edits and in a broker's reasons
- [x] 7.3 Run patterns on RE2; verify a catastrophic pattern returns at once on a real broker, and that a very long one is refused
- [x] 7.4 Say when a search or a history stopped early, in the API and on screen, on both sources; verify with API and browser tests
- [x] 7.5 One read-then-write at a time per entity; verify two adds on a real broker give one success and one conflict
- [x] 7.6 Fix what else the review found: `like` wildcards, malformed URLs, `..`, the history button, the keyboard race, clock-dependent tests; verify each with a test that failed before
