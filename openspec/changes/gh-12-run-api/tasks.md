# Tasks

## 1. Storage

- [ ] 1.1 Add migrations `002_runs.sql` and `003_incidents.sql` with the incident number sequence; verify that `db` tests apply them on an empty database and on one at migration 001
- [ ] 1.2 Implement the run repository (write a step or status in one transaction, load all) and `PostgresIncidentMemory` (`store` idempotent by run, `similar` ordering); verify `db` tests, including `similar` returning the same machine before the same type (spec: incident-records → Memory of confirmed diagnoses)

## 2. Run lifecycle

- [ ] 2.1 Implement the run manager with the allowed-state table, per-run locks, the concurrency semaphore (`MAX_CONCURRENT_ROUNDS` in settings and `.env.example`) and outcome mapping; verify tests for every allowed and refused operation per state, and for the limit with three runs (spec: run-api → Operations allowed per state, Bounded concurrency)
- [ ] 2.2 Implement start with input validation and short-name resolution; verify tests for start answering before the first step, a short name with one, none and several matches, a broker down, and invalid input (spec: run-api → Start a run)
- [ ] 2.3 Implement clarify, confirm and reject with file checks; verify tests for each scenario, including the rejected list in the next `awaiting_confirmation` state (spec: run-api → Clarify, Confirm or reject the resolution)
- [ ] 2.4 Implement stop (cancelling a round in progress) and archive; verify tests that no step follows a stop, and that an archived run leaves the active list and appears in history (spec: run-api → Stop and archive)
- [ ] 2.5 Implement restore at startup and the re-run of an interrupted round, plus the refusal when memory is unavailable; verify `db` tests with a second app instance for a paused run, a round interrupted between validate and decide, an interrupted act, and memory down (spec: run-api → Runs survive a restart)

## 3. API and stream

- [ ] 3.1 Add the endpoints from design decision 1 with the error shape; verify API tests for every endpoint and an error-shape test per kind (spec: run-api → Active runs and run status, Phase 1 limits are explicit, Stable error kinds)
- [ ] 3.2 Add the WebSocket stream with snapshot-first, bounded queues, keep-alive and unknown-run handling; verify tests for joining mid-run, two clients, a slow client, an unknown run and keep-alive (spec: run-stream → all requirements)

## 4. Incident records

- [ ] 4.1 Implement incident numbering, history records on archive, the list with filters, the detail, and reopen; verify tests for first pause, kept number, completed and stopped records, the machine/outcome/date filters, an unknown incident, reopen and already reopened (spec: incident-records → Incident numbers, History records, List and filter incidents, Reopen an incident)
- [ ] 4.2 Verify end to end with the scripted model that a confirmed incident of machine M appears as a past incident in the next run for M, also after a restart (spec: incident-records → Memory of confirmed diagnoses)

## 5. Documentation

- [ ] 5.1 Update `architecture.md` → API Layer, Memory Layer and Run persistence for phase 1; verify that they match design decisions 1, 4 and 5
- [ ] 5.2 Document the endpoints in `backend/README.md`; verify that every endpoint in design decision 1 is listed
- [ ] 5.3 Run `openspec validate gh-12-run-api --strict`; verify that it passes
