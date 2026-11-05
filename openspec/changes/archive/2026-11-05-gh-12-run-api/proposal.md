# Proposal

Issue: #12

## Why

The diagnostic workflow (`gh-12-agent-workflow`) can be run by a program but not from the UI. This change exposes it through the backend:
- runs that operators start, clarify, confirm, reject, stop and archive;
- a live stream of each run's steps;
- persistence, so open runs survive a restart;
- incident records for the history.

It is the third of four changes delivering issue #12.

## What Changes

- **Run operations** under `/api/agent/` (`architecture.md` → API Layer):
  - start (answers at once with the run id), list active runs, run status;
  - clarify, confirm or reject the resolution, stop and archive;
  - an escalation preflight that reports escalation as not available in this phase;
  - reopen, which reports that the run cannot be reopened.
- **Run lifecycle** in the service: each run's rounds run in the background. Operations are accepted only in the states that allow them; otherwise they are refused as conflicts. A configurable limit sets how many rounds run at the same time.
- **Run stream** over WebSocket at `/ws/run/{run_id}`: the current state first, then step and status events. Any number of clients can watch the same run.
- **Persistence** in the memory database:
  - Every run that is not archived is stored with its steps and state. It is restored at startup.
  - A round interrupted by a restart runs again.
- **Incident records:**
  - An incident number is given when a run first pauses.
  - Confirmed diagnoses are stored for similar-incident search (the PostgreSQL implementation of the workflow's memory interface).
  - Archiving a run creates its history record with the full trace.
  - Incident list with filters, incident detail, and reopening an incident as a new run.
- Errors with a stable kind (`not_found`, `conflict`, `invalid`, `unavailable`) that the UI maps directly.

## Capabilities

### New Capabilities

- `backend/run-api`: Run operations, the allowed operations per state, persistence and restart behaviour.
- `backend/run-stream`: The live event stream of a run.
- `backend/incident-records`: Incident numbering, memory of confirmed diagnoses, history records, filters and reopening.

### Modified Capabilities

None.

## Impact

- New code in `backend/app/` (`api/`, `runs/`, `memory/`). New migrations: `runs`, `incidents`, `agent_traces`.
- No new runtime dependencies.
- `architecture.md` sections affected:
  - **API Layer**: the table reflects the phase 1 endpoints; escalation, machine-builder and operator-approval endpoints stay listed as later phases.
  - **Memory Layer**: the schema. `pending_runs` becomes `runs`, which holds every non-archived run, because the UI lists finished runs until they are archived. `awaiting_confirmation` is added to the persisted states.
  - **Key Design Decisions → Run persistence**: updated in the same way.

## Out of Scope

- Escalation, machine-builder conversation, operator data approval and recommendation review (later phase). Their endpoints are not added.
- Runs started by events (`/events/*`, later phase).
- Use of attached files by the agent. Phase 1 records the names, types and sizes of files attached to clarifications and rejections; their content is not stored or analysed.
- Authentication of API clients (later phase, with sign-in).
- More than one backend process (`architecture.md` → in-memory store; horizontal scaling stays a later concern).
