# Design

## Context

See proposal.md → Why. After `gh-12-agent-workflow`, the `xana-agent` package offers stateless `analyse` and `act` calls that stream steps and end in an outcome. `architecture.md` → API Layer names the endpoints under `/api/agent/` and `/api/incidents`, and describes `RunRecord` with subscriber queues, the WebSocket at `/ws/run/{run_id}`, and `pending_runs` persistence.

The UI data interface (`frontend/docs/data-interface.md` → runs, incidents) defines the operations, state data and stream events the backend data source (`gh-12-ui-backend-source`) must deliver. This design matches them field for field, in snake_case.

## Goals / Non-Goals

**Goals:**
- Every run operation of phase 1 behaves as the UI data interface describes.
- No run is lost or duplicated across restarts.

**Non-Goals:**
- Escalation and conversation operations (later phase).
- Multiple backend processes.

## Decisions

### 1. Endpoints

| Endpoint | Method | Purpose | Success |
|---|---|---|---|
| `/api/agent/run` | POST `{machine_id, issue}` | Start | 202 `{run_id}` |
| `/api/agent/runs` | GET | Active runs (summaries) | 200 |
| `/api/agent/status/{run_id}` | GET | Run with `data`, `steps`, `escalation: null`, `outbox: []`, `reopenable` | 200 |
| `/api/agent/clarify/{run_id}` | POST `{text, files}` | Clarify | 200 `{status}` |
| `/api/agent/confirm-resolution/{run_id}` | POST `{confirmed, text, files}` | Confirm or reject | 200 `{status}` |
| `/api/agent/stop/{run_id}` | POST `{reason?}` | Stop | 200 `{status}` |
| `/api/agent/archive/{run_id}` | POST | Archive | 204 |
| `/api/agent/escalate-preflight/{run_id}` | GET | Always `{possible: false, reason, recipient: null, data: [], sharing_tier}` | 200 |
| `/api/agent/reopen/{run_id}` | POST | Always 409 in phase 1 | — |
| `/api/incidents` | GET `?machine_id&status=a,b&from&to` | History list | 200 |
| `/api/incidents/{id}` | GET | Detail | 200 |
| `/api/incidents/{id}/reopen` | POST | New run | 202 `{run_id}` |
| `/ws/run/{run_id}` | WebSocket | Run stream | — |

- **Errors** have the shape `{"error": {"kind", "message"}}`, with HTTP status 404, 409, 422 or 503. Request validation errors are mapped to `invalid`.
- **Files:** `files` items are `{name, type, size, data_url}`. The data URL is checked for type and size and then dropped; only the name, type and size are kept.

*Alternative:* resource-style paths (`/api/runs/{id}/clarify`). They read more cleanly, but deviate from `architecture.md` without a request to change it.

### 2. Run manager
- `RunManager` holds `RunRecord`s (run summary, `data`, `steps`, round number, clarifications, rejected list, incident number) in memory, mirrored to the `runs` table on every change.
- One `asyncio.Task` per active round.
- An `asyncio.Semaphore(MAX_CONCURRENT_ROUNDS)` (new setting, default 2) bounds concurrency. A run waiting for a slot stays `running` with no steps yet.
- Operations take a per-run lock, check the allowed-state table, then change state.
- Stop cancels the round task. A step that completes after cancellation is discarded.

Outcomes map to states:

| Outcome | State and `data` |
|---|---|
| `awaiting_input` | `{question, confidence, threshold}` |
| `awaiting_confirmation` | `{root_cause, recommended_action, confidence, rejected: [{root_cause, recommended_action, reason, at}]}` |
| `completed` | `{root_cause, recommended_action, confidence, incident_logged: true}` |
| `failed` | `{error, node}` |
| `stopped` | `{by: "operator", reason, reopenable: false}` |

### 3. Short machine names
If `machine_id` is not a URI, the broker is queried for entities whose id ends in `:<name>`. Exactly one match: its id is used. No match or several: the request is refused as `invalid`. If the broker is unreachable, the name is used as given and the observe step reports it.

### 4. Persistence and restart
The migrations are:
- `002_runs.sql`: `runs(run_id PK, incident_number, machine_id, issue, status, data JSONB, steps JSONB, round INT, clarifications JSONB, rejected JSONB, started_at, updated_at)`.
- `003_incidents.sql`, with two tables:
  - `incidents(id SERIAL, number INT UNIQUE, run_id UNIQUE, machine_id, machine_type, issue, outcome, root_cause, recommended_action, decision JSONB, resolution, confirmed BOOL, started_at, closed_at, archived_at, reopened_run_id)`;
  - `agent_traces(incident_id FK, step, action, input JSONB, output JSONB, timestamp)`, as named in `architecture.md`.
- An `incident_number` sequence.

How state is written and restored:
- Each step and status change is written in one transaction before it is published to watchers. A watcher never sees an event that would be missing after a restart.
- Each step records the round it belongs to.
- At startup, runs in `running` drop the steps of their current round and start that round again. If the interrupted round was the act after a confirmation, the act runs again; storing is idempotent by `run_id`.

`architecture.md` names the table `pending_runs` and keeps only paused runs. The UI keeps finished runs in the active list until they are archived, so `runs` keeps every non-archived run, and `architecture.md` is updated.

### 5. Incident records
- **Number:** taken from the sequence at the first status other than `running`.
- **Act:** stores via `PostgresIncidentMemory.store()` (the workflow memory interface): it upserts the `incidents` row with `confirmed = true`, root cause, action and trace.
- **Archive:** upserts the row with outcome, decision, resolution, `closed_at = archived_at = now()` and the full trace, then deletes the `runs` row. Both happen in one transaction.
- **`similar()`:** returns confirmed rows, same machine first, then same `machine_type`, newest first.
- **History list:** rows with `archived_at` set.
- **Resolution text:**

  | Outcome | Resolution |
  |---|---|
  | `completed` | The recommended action |
  | `stopped` | The stop reason |
  | `failed` | `The run failed: <error>` |

### 6. Stream
- Each `RunRecord` has a set of subscriber queues, bounded at 256 events.
- **Publish:** `put_nowait` into every queue. A full queue closes that subscriber with code 1013. The client's reconnect then starts with a fresh snapshot.
- **Messages:** `{type: "snapshot", run}`, `{type: "step", ...}`, `{type: "status", status, data, summary}` and `{type: "error", error}`.
- **Keep-alive:** WebSocket ping every 20 s.
- **Snapshot consistency:** the snapshot is taken under the run lock, together with registering the subscriber, so no event falls between them.

### 7. Tests
- **API tests** use the scripted model and fake sources, injected through the app factory, plus the `db` marker for persistence.
- **Restart tests** construct a second app instance on the same database.
- **Stream tests** use the test client's WebSocket support.

## Risks / Trade-offs

- **Single process:** the in-memory manager plus the database is not horizontally scalable. This is accepted for phase 1; `architecture.md` already notes the path.
- **Re-running an interrupted round** calls the model again. This is accepted, because rounds are short and restarts rare.
