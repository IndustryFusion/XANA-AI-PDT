# Tasks

## 1. Package foundations

- [ ] 1.1 Add the package structure from design decision 1, and a test asserting that `xana_agent` never imports `app`; verify that the test passes and fails on a deliberate import
- [ ] 1.2 Implement the schemas with the shared confidence normaliser; verify unit tests for `0.7`, `70`, `-0.2` and `250` (spec: diagnostic-workflow → Confidence normalisation)
- [ ] 1.3 Implement the source protocols, the in-memory memory, the fake sources and the scripted step answers in `testing.py`; verify that they are used by the tests below

## 2. Data sources

- [ ] 2.1 Implement the NGSI-LD context source (get, query, one-level traversal, entity cap); verify tests against a stubbed HTTP broker, including a missing entity and an unreachable broker
- [ ] 2.2 Implement the TimescaleDB history source (recent values with trend, bucketed metrics); verify `db` tests against the sample-data layout, and a test for an unreachable database
- [ ] 2.3 Assert that no source issues a write: the stubbed broker records methods and the history source runs read-only transactions; verify a test over a full run (spec: diagnostic-workflow → Read-only towards the factory → No writes)

## 3. Steps and graph

- [ ] 3.1 Implement observe with per-source status and partial data; verify tests for a machine with components, an unknown machine and the time-series store down (spec: diagnostic-workflow → Observe the machine, Graceful degradation → Time-series store down)
- [ ] 3.2 Implement hypothesize, including clarification and rejection input; verify tests for ranking and count (spec: diagnostic-workflow → Hypotheses)
- [ ] 3.3 Implement validate with plan trimming and the observed-entity filter; verify tests for verdicts, bounded checks and an issue text that asks for another machine's data (spec: diagnostic-workflow → Validation against data, Read-only towards the factory → Instruction in the issue text)
- [ ] 3.4 Implement decide with past incidents, gating and the rejected-cause guard; verify tests for low and sufficient confidence, past incidents, and memory down (spec: diagnostic-workflow → Confidence-gated decision, Graceful degradation → Memory down)
- [ ] 3.5 Implement act and the two graphs with step streaming; verify tests that steps arrive in order, each before the next starts, and that memory is written only by act (spec: diagnostic-workflow → Directed analysis round, Logging only after confirmation, Usable on its own)
- [ ] 3.6 Implement model timeout and the single retry; verify tests for a timeout in validate, and for a malformed answer followed by a valid one and by a second malformed one (spec: diagnostic-workflow → Model failure)
- [ ] 3.7 Cover the round sequences end to end with the scripted model: clarified, rejected once and rejected twice; verify the tests (spec: diagnostic-workflow → Clarification round, Rejection round)

## 4. Documentation

- [ ] 4.1 Write `backend/agent/README.md` with a standalone usage example; verify that the example runs with the scripted model
- [ ] 4.2 Update `architecture.md` → Agent Runtime, Tool Layer and the Directed workflow decision for the phase 1 sequence; verify that the sections match design decisions 2–9
- [ ] 4.3 Run `openspec validate gh-12-agent-workflow --strict`; verify that it passes
