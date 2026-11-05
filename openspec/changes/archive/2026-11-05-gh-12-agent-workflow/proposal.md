# Proposal

Issue: #12

## Why

The UI can show a diagnosis step by step, but nothing in the repository produces one. This change builds the diagnostic agent as a self-contained workflow package. It observes a machine, proposes hypotheses, validates them against the machine's data, decides with a confidence gate and logs the incident once the operator has confirmed. It is the second of four changes delivering issue #12 and builds on `gh-12-backend-foundation`.

## What Changes

- Implement the workflow in the `xana-agent` package (`backend/agent/`). It is usable without the backend service: a program gives it a machine, an issue, a language model and its data sources, and receives each completed step as it happens.
- Directed workflow `OBSERVE → HYPOTHESIZE → VALIDATE → DECIDE → ACT` (`manifest.md` → Agent Runtime, `architecture.md` → Key Design Decisions → Directed workflow over ReAct).
- Confidence gate:
  - Below the threshold, the round ends waiting for operator input, with a question naming what is missing.
  - At or above the threshold, it ends waiting for confirmation of the proposed resolution.
  - ACT runs only after confirmation.
- Further rounds: a clarification starts a new round that uses the added information. A rejected resolution starts a new round that does not propose the rejected root cause again.
- Typed results for every model answer, with confidence normalised to `[0, 1]`.
- Graceful degradation: an unavailable context broker, time-series store or memory gives partial data, not a failed run.
- Data sources:
  - The NGSI-LD context broker: get, query and traverse.
  - Attribute history in TimescaleDB: recent values and aggregated metrics.
  - Incident memory: similar incidents, store incident. The package defines the memory interface and ships an in-memory implementation; the PostgreSQL implementation follows in `gh-12-run-api`.
- Tests that run without network or model, using the scripted model and fake sources.

## Capabilities

### New Capabilities

- `backend/diagnostic-workflow`: How the agent diagnoses an issue for a machine, from observation to logged incident, including rounds, gating and degradation.

### Modified Capabilities

None.

## Impact

- New code in `backend/agent/` and its tests. Two new runtime dependencies of the agent package, both already backend dependencies: `psycopg` for attribute history and `httpx` for the context broker.
- `architecture.md` sections affected:
  - **Agent Runtime**: the node table and graph are updated to the phase 1 workflow. Phase 1 has no retrieve step: the node sequence is the one in `manifest.md` → Agent Runtime.
  - The **awaiting_confirmation** routing and the confirmation-gated ACT are described.
  - **Tool Layer**: the module list is updated for the package layout. Alerta, gateway and IFRIC tools are not part of phase 1.
- **Key Design Decisions → Directed workflow over ReAct**: the text mentions a retrieve step that phase 1 does not include. The sentence is updated to the phase 1 sequence.

## Out of Scope

- Starting runs over HTTP, the run stream and persistence (`gh-12-run-api`).
- Reading alerts from an alert manager in OBSERVE (alerts backend is a later phase).
- Escalation, policy checks and the machine-builder conversation (later phase).
- Any write to the context broker or the time-series store.
