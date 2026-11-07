# XANA AI PDT — Architecture

## Purpose

XANA AI PDT (Process Digital Twin AI) is a stateful industrial diagnostic system. It observes machine and process state via NGSI-LD, reasons over anomalies using a structured LLM agent loop, and surfaces structured corrective actions through a dashboard UI.

It is not a chatbot. Every output is a typed, structured artifact: a hypothesis with a confidence score, a root cause, a recommended action, a logged incident.

---

## System Overview

> **Document retrieval is not part of the current system.** The diagram shows the target system. Its RETRIEVE step, RAG Tool and RAG Tool Microservice are not built, and the workflow runs without them. The UI's knowledge base is off by default (`VITE_KNOWLEDGE_BASE`, see [`frontend/README.md`](frontend/README.md)).

```
┌─────────────────────────────────────────────────────────────────────────┐
│  Frontend (React + Vite)                                                │
│  Dashboard │ Active incidents │ Incident history │ Data explorer        │
│  Alerts │ Dataspace │ System          UI data interface → data source   │
└───────────────────────────┬─────────────────────────────────────────────┘
                            │ REST + WebSocket
┌───────────────────────────▼─────────────────────────────────────────────┐
│  Backend (Python / FastAPI)                                             │
│                                                                         │
│  ┌─────────────┐  ┌──────────────┐  ┌──────────────────────────────┐   │
│  │  REST API   │  │  WebSocket   │  │  Event Webhooks              │   │
│  │ /api/agent  │  │ /ws/run/{id} │  │ /events/ngsi                 │   │
│  │ /api/gateway│  │              │  │ /events/alert                │   │
│  │ /api/ifric  │  │              │  └──────────────┬──────────────┘   │
│  └──────┬──────┘  └──────┬───────┘                │                  │
│         └────────────────┼────────────────────────┘                   │
│                          │                                             │
│  ┌───────────────────────▼──────────────────────────────────────────┐  │
│  │  Agent Runtime (LangGraph)                                       │  │
│  │                                                                  │  │
│  │  OBSERVE → HYPOTHESIZE → RETRIEVE → VALIDATE → DECIDE ──→ ACT   │  │
│  │                               │                   │            │  │
│  │                          rag_retrieve()            ├──→ awaiting_input        │  │
│  │                          (HTTP)                   └──→ awaiting_confirmation  │  │
│  └─────┬──────────┬─────────────┼──────────────────────────┬─────┘  │
│        │          │             │                          │         │
│  ┌─────▼────┐  ┌──▼───────┐  ┌─▼──────────┐  ┌───────────▼──────┐  │
│  │NGSI Tool │  │Timescale │  │  RAG Tool  │  │ Gateway Tool     │  │
│  │          │  │Tool      │  │(retrieval  │  │ IFRIC Tool       │  │
│  └─────┬────┘  └──┬───────┘  │ service    │  └─────────┬────────┘  │
│        │          │          │ HTTP POST) │            │           │
│  ┌─────▼────┐  ┌──▼───────┐  └─────┬──────┘  ┌────────▼────────┐  │
│  │ Memory   │  │ Alerta   │        │         │  Inbox Poller   │  │
│  │  Tool    │  │  Tool    │        │         │  (30s loop)     │  │
│  └──────────┘  └──────────┘        │         └─────────────────┘  │
└────────┬──────────┬────────────────┼──────────────┬───────────────┘
         │          │                │              │
┌────────▼────┐  ┌──▼───────────┐  ┌▼──────────────────────────────┐
│   Scorpio   │  │ TimescaleDB  │  │  RAG Tool Microservice        │
│  (NGSI-LD)  │  │  (signals)   │  │                               │
└─────────────┘  └──────────────┘  │  ingestion-service            │
         │                         │  parse/chunk/embed PDFs        │
┌────────▼──────────────────┐      │  → pgvector                   │
│  PostgreSQL               │      │                               │
│  incidents │ agent_traces │      │  retrieval-service            │
│  runs                     │      │  embed query → pgvector       │
└───────────────────────────┘      │  search → rerank → chunks     │
                                   │                               │
┌──────────────────────────┐       │  pgvector  (rag DB)           │
│  IFF Dataspace           │       │  Ollama    (embed + VLM)      │
│  Gateway + IFRIC         │       └───────────────────────────────┘
└──────────────────────────┘
```

---

## Components

### Frontend (`frontend/`)

Built with React 18 + Vite in JavaScript. Structured views, no chat interface. Every area and selected item has its own URL.

| Area | Responsibility |
|---|---|
| Sign-in and shell | Sign-in when authentication is enabled; header with main navigation, user and factory details, dataspace indicator with reconnect hint; cross-navigation from any entity reference (open in data explorer, start incident, show active incidents, show history) |
| Dashboard | Tiles for active incidents, open alerts, data overview, dataspace and system health, each loading and failing independently |
| Active incidents | Open runs; new-incident form (`machine_id` + issue); run view with live steps, hypotheses, decision, one panel per waiting state, and the machine-builder conversation |
| Incident history | Past incidents with full agent trace; reopen |
| Data explorer | NGSI-LD entities, relationships, attribute history, time-shift, edits, import, live updates |
| Alerts | Alert list, filters, actions, detail |
| Dataspace | Gateway connection, peers and capabilities, capability requests, sharing tier |
| System | Dependency health, service settings; knowledge-base documents only when the knowledge base is turned on |

**Data layer.** Screens obtain data only through the UI data interface (`src/data`), one module per area: session, runs, incidents, entities, alerts, dataspace, system health, and the optional knowledge base. A data source implements the interface and is selected with `VITE_DATA_SOURCE`:
- `mock` (default): runs in the browser with deterministic seeded data, a simulated run engine, and development controls for per-area latency and failure. No backend is needed.
- `backend`: the operations the backend provides (session, runs and their stream, incident history, the Data Explorer's entities, alerts, system health) over REST and WebSocket, with key mapping (snake_case ↔ camelCase), error mapping and stream reconnection. Every other operation is delegated to the mock source (`{ ...mock[area], ...backend[area] }`), so the whole UI stays usable while later phases bring their backends. Attaching it changed no screen.

The interface is documented in `frontend/docs/data-interface.md`. Lint rules forbid screens from importing a data source or doing network I/O directly.

**Run states the UI represents:**

| State | Meaning |
|---|---|
| `running` | Agent pipeline executing; steps stream in |
| `awaiting_input` | Confidence below threshold; operator clarifies or escalates |
| `awaiting_confirmation` | Proposed resolution; operator confirms, or rejects with a reason (new round) |
| `awaiting_machine_builder` | Escalated via the dataspace; conversation open |
| `awaiting_operator_approval` | Machine builder requested data beyond the sharing tier |
| `awaiting_recommendation_review` | Machine builder sent a recommendation to accept or reject |
| `mb_closed` | Machine builder closed the conversation |
| `completed` · `failed` | Terminal outcomes |
| `stopped` | Closed by the operator; reopenable when a conversation exists |
| archived | Removed from the active list; available in incident history |

The run stream delivers the run's current state first, then step events (one per agent step, including retrieval, policy-check, resolution and conversation steps) and status events. Reconnection and polling are handled inside the data source.

**Key files:**
- `src/data/index.js`: data facade; selects the data source
- `src/data/interface.js`: operations per area and result shapes
- `src/data/sources/mock/`: mock data source and development controls
- `src/data/sources/backend/`: backend data source (HTTP, run stream, key and error mapping, delegation to the mock)
- `src/app/`: router, session gate, header, entity references
- `src/ui/`: design tokens (CSS custom properties, dark and light themes, no CSS framework) and shared components
- `src/features/`: one folder per area

**Tests:** Vitest with Testing Library (components, data interface), Playwright with axe (end to end, accessibility), ESLint. The `Frontend` workflow runs them on every pull request that touches `frontend/`. The `Backend` workflow's `integration` job runs `frontend/e2e/backend/` against the local environment with the scripted model.

---

### Backend (`backend/`)

Python 3.12 + FastAPI, async throughout; database access with psycopg 3 (async).

The backend is delivered in phases (issue #12). This section describes the target; what exists today is the service runtime (configuration, language model factory, `GET /api/diagnostics`), the memory database migrations, the local environment, the diagnostic agent workflow package, and the phase 1 run API with its stream and incident history.

**Layout.** Two Python packages:

```
backend/
  app/                 service: config.py (settings, get_llm), health.py, api/, runs/, memory/
  migrations/          numbered .sql files, applied at startup
  agent/xana_agent/    diagnostic agent workflow and its tools: a package of its own,
                       installable and testable without the service
  sample_data/         sample machine data and its loader (local environment)
  compose.yaml         local environment
```

The agent package never imports the service. The service uses it like any other program would.

**Local environment.** `docker compose -f backend/compose.yaml up --build` starts PostgreSQL with TimescaleDB (databases `memory`, `tsdb` and the broker's), Scorpio, Ollama (pulling `LLM_MODEL` once), the backend on port 8000 and a one-off loader for the sample machine data. The sample data is exported from the UI mock's seed (`frontend/scripts/export-sample-data.mjs`), so machine identifiers agree between the UI and the backend. `LLM_PROVIDER=scripted` runs everything without downloading a model; its runs ask one question, then propose a diagnosis once the operator has clarified. The frontend development server forwards `/api` and `/ws` to `XANA_BACKEND_URL` (default `http://localhost:8000`). See `backend/README.md`.

#### API Layer (`app/api/`)

Fields are snake_case. A refused request answers `{"error": {"kind", "message"}}` with kind `not_found` (404), `conflict` (409), `invalid` (422) or `unavailable` (503); the UI maps the kind directly.

| Endpoint | Method | Description |
|---|---|---|
| `/api/agent/run` | POST | Start a run for `{machine_id, issue}`; returns `run_id` immediately (202). A short machine name is resolved through the broker |
| `/api/agent/runs` | GET | List all runs that are not archived, newest first |
| `/api/agent/status/{run_id}` | GET | Run with state data, steps, `escalation`, `outbox` and `reopenable` |
| `/api/agent/clarify/{run_id}` | POST | Operator clarification for a run in `awaiting_input`; starts a new round |
| `/api/agent/confirm-resolution/{run_id}` | POST | Confirm the proposed resolution (runs `act`) or reject it with a reason (new round) |
| `/api/agent/stop/{run_id}` | POST | Stop an open run, cancelling a round in progress |
| `/api/agent/archive/{run_id}` | POST | Move a finished run to the incident history |
| `/api/agent/escalate-preflight/{run_id}` | GET | Whether escalation is possible, why not, the recipient and what would be sent. Sends nothing |
| `/api/agent/escalate/{run_id}` | POST | Send the incident to the machine builder. A failure leaves the status as it was |
| `/api/agent/outbox-status/{run_id}` | GET | Delivery of what the run sent |
| `/api/agent/reopen/{run_id}` | POST | Go on with a run's conversation; `conflict` without one, or after `escalated` or `superseded` |
| `/api/incidents` | GET | History, filtered by `machine_id`, outcomes (`status=a,b`) and an inclusive closing date range (`from`, `to`) |
| `/api/incidents/{id}` | GET | Incident detail + full agent trace |
| `/api/incidents/{id}/reopen` | POST | Start a new run with the incident's machine and issue |
| `/api/diagnostics` | GET | Live connectivity check: PostgreSQL, TimescaleDB, Scorpio, LLM |
| `/ws/run/{run_id}` | WebSocket | Live stream: the run's snapshot first, then step and status events |
| `/api/agent/conversation-act/{run_id}` | POST | The operator sends `inform`, `request`, `escalate`, `deescalate`, `close` (with an outcome) or `cancel` |
| `/api/agent/ask/{run_id}` | POST | A question to the incident agent; nothing is sent to the machine builder |
| `/api/agent/approve-data-request/{run_id}` | POST | Approve or decline a data request |
| `/api/agent/recommendation-reply/{run_id}` | POST | `resolved`, `still_failing` or `escalate` |
| `/api/agent/refresh-conversation/{run_id}` | POST | Read the conversation's state at the gateway |
| `/api/agent/record-close/{run_id}` | POST | Record a close communicated elsewhere |
| `/api/agent/message-files/{run_id}/{message_id}` | GET | The files of a received message |
| `/api/ngsi/*` | — | Data Explorer: query, edit, import, history and time-shift, on `NGSI_URL` and `PGREST_URL` only, and live updates (`/api/ngsi/ws`) through a broker subscription with an MQTT endpoint. For operators; the workflow has no path to it |
| `/api/alerta/*` | — | Alerts screen: list, count, detail, actions, environments, services, on `ALERTA_URL` only. Actions are for operators; the workflow only reads |
| `/api/gateway/*` | — | The dataspace connection: `config`, `status`, `connect`, `disconnect`, `token-claims`, `peers`, `peers/{id}/capabilities`, `policies`, `capabilities/requests`, `capabilities/policy`. Answers never hold a token or secret |
| `/api/ifric/*` | — | The IFRIC registry, with the dataspace token: `config`, `status`, `factory`, `resolve`, `resolve-builders`. For the backend only, and not an agent tool |
| `/events/ngsi` | POST | *Later phase.* Webhook for Scorpio NGSI-LD notifications |
| `/events/alert` | POST | *Later phase.* Webhook for external alert systems |

**Runs** (`app/runs/`). `RunManager` holds one `RunRecord` per non-archived run: its stored state, a lock that every change takes, the task of the round in progress and the subscribers of its stream. Each round runs as an `asyncio` task; at most `MAX_CONCURRENT_ROUNDS` run at once and further rounds wait in `running`. An operation is accepted only in the statuses that allow it (clarify in `awaiting_input`; confirm or reject in `awaiting_confirmation`; stop in `running`, `awaiting_input`, `awaiting_confirmation`; archive in `completed`, `failed`, `stopped`), otherwise it is refused as `conflict`. Stopping cancels the round; a step that completes afterwards is discarded. Operator answers are recorded as `clarification` and `resolution` steps; attached files keep only name, type and size.

**Stream.** Each subscriber has a queue of 256 events; publishing never waits. A full queue closes that subscriber (code 1013) and its reconnect starts with a fresh snapshot. The snapshot is taken together with registering the subscriber, under the run's lock, so no event falls between them. A `keepalive` message is sent after 20 s without events. An unknown or archived run gets an `error` event and close code 4404.

The in-memory manager is sufficient for a single-process deployment; for horizontal scaling it would need a shared store.

#### Agent Runtime (`agent/xana_agent/`)

Two LangGraph `StateGraph`s over one `AgentState`, compiled when a `Workflow` is created. Phase 1 runs the sequence of `manifest.md` → Agent Runtime; it has no retrieve step.

```
analyse:  observe → hypothesize → validate → decide → END
                                                  ├── confidence < threshold  → outcome awaiting_input
                                                  └── confidence ≥ threshold  → outcome awaiting_confirmation
act:      act → END            (called only after the operator confirmed the proposed resolution)
```

There is no edge from `decide` into `act`. The confirmation is an operator action between the two calls, so an unconfirmed diagnosis cannot be logged. The package keeps nothing between calls: the caller (the API layer) owns the run and passes the round's input each time, so a paused run survives a restart.

```python
workflow = Workflow(llm, context, history, memory, threshold=0.9)
async for event in workflow.analyse(RoundInput(machine_id, issue, round, clarifications, rejected)):
    ...  # StepEvent(node, input, output, at) per completed step, then one Outcome
async for event in workflow.act(round_input, decision, trace):
    ...  # StepEvent("act", ...), then Outcome completed (with incident ID) or failed
```

Each step is delivered when it completes, before the next starts. `Outcome.kind` is `awaiting_input` (question, confidence, threshold), `awaiting_confirmation` (root cause, recommended action, confidence), `completed` (incident ID) or `failed` (step and reason).

| Node | Reads | LLM call | Step output |
|---|---|---|---|
| `observe` | Context: the machine, entities one relationship away in either direction (at most 20). History: last value and trend per numeric attribute (24 h) | No | `summary`, `signals` (`name`, `value`, `unit`, `assessment`), `sources` (status per source), `partial_data`, `entities` |
| `hypothesize` | — | `HypothesisList` | `hypotheses`: two or three, ranked, IDs `h<round>-<n>` |
| `validate` | History: bucketed min, max, average and last value; context: fresh entity reads. At most 6 queries and 3 lookups per round, observed entities only | `ValidationPlan`, then `ValidatedHypothesisList` | `hypotheses` with `verdict` (`confirmed`, `plausible`, `inconclusive`, `refuted`), updated `confidence` and `validation` notes |
| `decide` | Memory: up to 3 similar incidents (same machine, then same type) | `Question` or `Decision` | `root_cause`, `recommended_action`, `confidence`, `threshold`, `question`, `past_incidents` |
| `act` | Memory: stores the incident with the full step trace | No | `action`, `recommended_action`, `incident_logged`, `incident_id` |

Step content uses the field names of the UI's data interface, in snake_case; the frontend adapter maps them to camelCase.

**Confidence gate.** `decide` takes the highest validated confidence among hypotheses that are neither refuted nor rejected by the operator. That number is shown and compared with `DECISION_CONFIDENCE_THRESHOLD` (default 0.9). Below it, the model writes a question naming the missing information. At or above it, the model writes the recommended action; the root cause is the leading hypothesis, never a rejected one.

**Rounds.** A clarification (`POST /api/agent/clarify/{run_id}`) or a rejected resolution starts a new round from `observe`. The round's input carries all clarifications and all rejected root causes with their reasons; `hypothesize` sees them, and `decide` never proposes a rejected root cause again.

**Model calls.** Every call asks for a structured answer: through the schema as `format` on Ollama, accepting content or a tool call; in the prompt on OpenAI-compatible servers set through `OPENAI_BASE_URL`; and through `with_structured_output` on cloud providers. Calls have a timeout of `LLM_TIMEOUT_S` and up to three retries when the answer does not match the structure. A timeout or a fourth mismatch fails the round with the step and a readable reason. Prompts (`agent/xana_agent/prompts/`) pass every value as JSON in a named section; operator text is marked as data, never as instructions.

**Sign-in.** With `KEYCLOAK_URL` set, the backend signs in to Keycloak for the operator with the password grant, keeps the token fresh in memory, and sends it to the context broker. There is one session per backend process, and the backend's own API is not protected, so network access to it must be limited. With nobody signed in, broker requests carry no token. These are open decisions, recorded in the `gh-21-keycloak-sign-in` design.

**Dataspace connection.** With `GATEWAY_URL`, the backend holds a `client_credentials` token of the dataspace realm, separate from the operator's, in memory. It is checked every 60 seconds and renewed with 120 seconds left, and renewal stops after 3 failures in a row, which the operator sees. The client secret is stored encrypted in `gateway_credentials`, with no plaintext fallback. The `gateway` and `connector` health checks read the gateway and, through it, the participant's adapter.

**IFRIC registry.** Company names, machine builders and factory details, for the backend only. A machine's builder is asked for with its entity ID; machine names come from the context broker. Not found, a refusal and an outage are told apart: a name is left out or empty, a builder comes with a reason, and in the health report `401` and `403` are failures.

**Read-only.** Sources only read: the context source sends GET requests, the history source runs read-only transactions. The validation plan is limited to the entities observed in the round, so text in the issue cannot widen what is read. Memory is written only by `act`.

**Escalation flow.** When the operator clicks "Escalate to machine builder":

```
POST /api/agent/escalate/{run_id}
  │
  ├─ IFRIC lookup: GET /company/assets/{machine_id}/manufacturer → company_ifric_id, company_name
  ├─ Gateway peer match: GET /participants/compatible
  ├─ Policy: DATA_SHARING_POLICY and GET /capabilities/access?consumer= (auto or approved)
  │    → policy_check step
  ├─ File transfer: POST /outbox/files (starts the conversation)
  ├─ Structured message: POST /outbox/messages (incident; performative request; same conversation)
  └─ Run transitions to awaiting_machine_builder, with an ESC-… reference
```

Possible from `awaiting_input` and `awaiting_confirmation`. While it sends, a mark on the run refuses other operator actions, without holding the run's lock, so the stream goes on. A failure is an `escalate_failed` step and the status stays; trying again doesn't send the files again. A background task polls `GET /outbox/messages/{id}/status` until final: `notified` shows as `delivered`, `error` and `rejected` as `failed`.

**Inbox polling.** A background task reads `GET /inbox/messages?status=received` every `INBOX_POLL_INTERVAL_S` (default 15). A message's conversation is read from `GET /conversations/{id}`, its files are stored, and the run with its step and the message's ID are stored in one transaction before it is acknowledged, so nothing is lost or handled twice. A message for no run or incident stays unacknowledged.

**Policy-gated data sharing.** When a machine builder asks for data, with a `request` naming a capability, the run moves to `awaiting_operator_approval`, within the tier or not, showing which it is. Nothing is sent to a peer except by an operator's request:

```
request(capability)
  │
  ├─ awaiting_operator_approval, with an agent review
  │    ├─ approve → POST /capabilities/policy, grant with an authorization, that capability's data
  │    │            → policy_check step → awaiting_machine_builder
  │    └─ decline → deny → awaiting_machine_builder
```

An `inform` with `recommendation` in its payload moves the run to `awaiting_recommendation_review`. That field is the only source, so a model can't make one up.

**Conversation agent** (`agent/xana_agent/conversation/`). Apart from the read-only workflow, with a graph of its own. It reads through data tools limited to the entities observed in the run, and the ontology's read functions, and it answers the operator. Its `send_*` tools only prepare a suggestion: the package has no way to reach the dataspace. A turn starts from the run's stored steps, so a restart loses nothing. `agent/xana_agent/conversation/cases.json` holds repeatable evaluation cases.

Data-sharing tiers mirror the pre-negotiated IFF Dataspace capabilities:

| Policy | Capability | Data sent |
|---|---|---|
| `minimal` | `twin:direct` | The machine's entity and active alerts |
| `adjacent` | `twin:adjacents` | Plus entities one relationship away and their active alerts |
| `timeseries` | `twin:history` | Plus 24 hours of signal history: the machine's, and of related entities only if those may go too |

Every transmission goes through `apply_policy()` which strips files outside the configured tier before the gateway call. A `policy_check` step event is pushed over the WebSocket so the operator can see exactly what was allowed and what was stripped.

Every node catches source errors and continues with partial data — a missing NGSI or Timescale connection degrades gracefully rather than crashing the run. State is a plain `TypedDict` (`AgentState`); each node returns its updates and its step record.

LLM structured output uses Pydantic models (`agent/xana_agent/schemas.py`) passed to `llm.with_structured_output(...)`. All confidence fields include a normaliser validator that accepts both `0.7` and `70` from the LLM and always stores a `[0, 1]` float. The LLM provider is resolved at call time via `get_llm()` — see Configuration section.

#### Tool Layer (`agent/xana_agent/`)

The workflow reads through three protocols (`sources/base.py`), so a program can supply its own implementations:

| Module | Protocol and implementation | Backend |
|---|---|---|
| `sources/ngsi.py` | `ContextSource`: `NgsiContextSource` (get an entity; entities one relationship away, including those whose `partOf` or `measures` points to it) | `httpx` HTTP GET to Scorpio, optional `NGSILD-Tenant` |
| `sources/timescale.py` | `HistorySource`: `TimescaleHistorySource` (recent values with trend; bucketed metrics) | psycopg 3, read-only transactions, attribute table `TIMESCALE_TABLE` |
| `sources/memory.py` | `IncidentMemory`: `InMemoryIncidentMemory` (similar incidents, store) | Process memory; the PostgreSQL implementation lives in the service, which owns the schema |

`testing.py` provides fake sources and scripted answers for every step; the scripted provider (`LLM_PROVIDER=scripted`) uses them, so a complete run works without a model. Active alerts come from an optional source; dataspace gateway and IFRIC sources are not part of phase 1.

#### Knowledge Base (`rag-tool`)

> **Not part of the current system.** This section describes a possible later addition. Nothing in this repository provides this service.

[`rag-tool-microservice`](rag-tool-microservice/README.md) is a
separately-deployed service that gives the agent a document-grounded
knowledge base — e.g. equipment manuals, maintenance procedures, spec
sheets — instead of relying on the LLM's parametric knowledge alone. It is
**not** part of the core agent loop above; it's exposed as a normal **MCP
tool server** (`mcp` gateway) that a ReAct-style or tool-calling agent node
calls alongside `ALL_TOOLS`, the same way `tools/ifric.py` or
`tools/alerta.py` are called today.

```
Agent node ──MCP──► rag-tool `mcp` gateway ──┬─► ingestion-service (writes: parse/chunk/embed PDFs → pgvector)
                                              └─► retrieval-service (reads: embed query → search → rerank → grounded answer)
```

* Bring-your-own embedding/reranker/VLM — self-hosted (e.g. OpenVINO Model
  Server) or any OpenAI-API-compatible cloud provider (IONOS Cloud AI Model
  Hub, Claude, OpenAI, etc.) — configured per-service, no code changes to
  switch.
* Vectors live in pgvector — either the chart's own bundled Postgres, or (as
  deployed alongside `xana-pdt` — see "Deployment Architecture" below) a
  dedicated `rag` database on the **same** Postgres cluster as this app's
  `tsdb`/`memory` databases.
* Full design, API surface, and deployment instructions:
  [`rag-tool-microservice/README.md`](rag-tool-microservice/README.md) and
  [`rag-tool-microservice/docs/kubernetes.md`](rag-tool-microservice/docs/kubernetes.md).

#### Event Layer (`app/events/`)

Decouples external triggers from agent execution.

```
Scorpio notification → POST /events/ngsi ─┐
External alert       → POST /events/alert ─┤→ asyncio.Queue → event_worker → agent run
User action          → POST /api/agent/run ─┘ (bypasses queue, direct)
```

`event_worker` runs as a background asyncio task throughout the server lifetime. It deduplicates: if a machine already has an active run, subsequent events for that machine are dropped. Each run is fired as a separate `asyncio.create_task` so the worker is never blocked by a slow agent.

On startup, the backend registers a Scorpio NGSI-LD subscription watching `status`, `errorCode`, `alarmLevel`, `faultCode` on all `Machine` entities. The subscription is idempotent (upserted by stable ID).

#### Memory Layer (`app/memory/`)

PostgreSQL as the AI memory store — not for system state.

**Schema** (migrations applied automatically at startup):

```sql
-- 002_runs.sql: every run that is not archived
runs (
    run_id          TEXT PRIMARY KEY,
    incident_number INT,
    machine_id      TEXT,
    issue           TEXT,
    status          TEXT,   -- running | awaiting_input | awaiting_confirmation | completed | failed | stopped
    data            JSONB,  -- state data of the status
    steps           JSONB,  -- completed steps, each with its round
    round           INT,
    clarifications  JSONB,
    rejected        JSONB,  -- rejected resolutions with reasons
    started_at      TIMESTAMPTZ,
    updated_at      TIMESTAMPTZ,
    escalation      JSONB,  -- 005_escalation.sql: reference, recipient, tier, data sent
    outbox          JSONB,  -- delivery of what was sent
    conversation_id TEXT,
    attempt         JSONB   -- how far an escalation that failed got
)

-- 003_incidents.sql
incident_number   SEQUENCE   -- given when a run first leaves running

incidents (
    id                 SERIAL PRIMARY KEY,
    number             INT UNIQUE,
    run_id             TEXT UNIQUE,
    machine_id         TEXT,
    machine_type       TEXT,
    issue              TEXT,
    outcome            TEXT,     -- completed | failed | stopped, set when archived
    root_cause         TEXT,
    recommended_action TEXT,
    decision           JSONB,    -- the last decide step's output
    resolution         TEXT,
    confirmed          BOOLEAN,  -- the operator confirmed the diagnosis
    confirmed_at       TIMESTAMPTZ,
    started_at         TIMESTAMPTZ,
    closed_at          TIMESTAMPTZ,
    archived_at        TIMESTAMPTZ,
    reopened_run_id    TEXT,
    builder            TEXT,     -- 005_escalation.sql
    escalation         JSONB,
    conversation_id    TEXT
)

-- 006_conversation.sql
processed_inbox (message_id TEXT PRIMARY KEY, run_id TEXT, processed_at TIMESTAMPTZ)
conversation_files (message_id TEXT PRIMARY KEY, run_id TEXT, content BYTEA)

-- 004_gateway_credentials.sql
gateway_credentials (
    id                BOOLEAN PRIMARY KEY,  -- one row at most
    client_id         TEXT,
    encrypted_secret  TEXT,
    connect_wanted    BOOLEAN               -- false after the operator disconnected
)

agent_traces (
    id          SERIAL PRIMARY KEY,
    incident_id INT REFERENCES incidents(id) ON DELETE CASCADE,
    step        INT,
    round       INT,
    action      TEXT,      -- observe | hypothesize | validate | decide | act | clarification | resolution
    input       JSONB,
    output      JSONB,
    timestamp   TIMESTAMPTZ
)
```

`runs` is the persistence backing for every run that is not archived; the UI lists finished runs until the operator archives them. Each step and status change is written in one transaction before it is published to watchers, so a watcher never sees an event that would be missing after a restart. At startup the backend restores all rows. A run in `running` drops the steps of its current round and runs that round again; if the round was the `act` after a confirmation, only `act` runs again (storing is idempotent by run).

`incidents` serves two purposes. `act` stores a confirmed diagnosis through `PostgresIncidentMemory`, the workflow's `IncidentMemory`; `similar()` returns confirmed rows of the same machine first, then of the same machine type, newest first. Archiving writes the history record (outcome, decision, resolution, close time and full trace) and removes the `runs` row in one transaction; the history lists rows with `archived_at` set.

If the memory database is not reachable, runs cannot be stored: starting a run is refused as `unavailable`, and migrations and the restore happen on the first request after it is back.

`app/memory/migrate.py` maintains a `schema_migrations` tracking table and applies `.sql` files in lexicographic order. Idempotent — safe to call on every startup.

---

## Data Layer

| Store | Purpose | Access pattern |
|---|---|---|
| **Scorpio (NGSI-LD)** | Live machine context, relationships | HTTP via NGSI-LD v1 API |
| **TimescaleDB** | Attribute history (signals and telemetry) | SQL via psycopg 3; `time_bucket` for aggregation |
| **PostgreSQL** | AI memory: incidents + agent traces | SQL via psycopg 3 |
| **PostgREST** | The Data Explorer's attribute history and time-shift, on TimescaleDB | HTTP with the operator's token; the agent uses SQL |
| **Fuseki** | Machine ontology and SHACL shapes in named graphs; value hints, and read functions for the conversation agent | SPARQL over HTTP, read-only |
| **Alerta** | Active alerts and alarm history | HTTP via Alerta REST API (`Authorization: Key`) |

The backend reads attribute history in the layout the IFF Digital Twin platform writes: one row per observed attribute value, in a table named by `TIMESCALE_TABLE` (default `attributes`):
```sql
attributes ("id" TEXT, "parentId" TEXT, "observedAt" TIMESTAMPTZ, "modifiedAt" TIMESTAMPTZ, "entityId" TEXT,
            "attributeId" TEXT, "attributeType" TEXT, "datasetId" TEXT, "nodeType" TEXT, "value" TEXT,
            "valueType" TEXT, "unitCode" TEXT, "lang" TEXT, "deleted" BOOLEAN)
entities   ("id" TEXT, "observedAt" TIMESTAMPTZ, "modifiedAt" TIMESTAMPTZ, "type" TEXT, "deleted" BOOLEAN)
```
The local environment creates this table and fills it with 24 hours of sample history ending at load time.

---

## Configuration

All backend configuration is via environment variables, read by `pydantic-settings` (`app/config.py`).

In **production** (K8s), non-sensitive config comes from a Helm-rendered ConfigMap and sensitive values from a Secret — both injected as `envFrom` in the backend Deployment. See `helm/charts/xana-pdt/templates/backend-configmap.yaml` and `backend-secret.yaml`.

For **local development**, copy `backend/.env.example` to `backend/.env` and fill in credentials. `backend/.env.example` lists every variable the backend reads, with its default; an invalid value stops the backend at startup with a message naming the variable (never its value). Secrets are never returned or logged; connection URLs are shown with the password masked.

Key variable groups:

```
# LLM
LLM_PROVIDER=ollama                  # ollama | anthropic | openai | scripted (fixed answers, no model)
LLM_MODEL=llama3.1
OLLAMA_URL=http://...
LLM_TIMEOUT_S=120
LLM_NUM_CTX=32768                    # context size given to Ollama
LLM_PROVIDER_NAME=                   # name operators see, for example OpenVINO
ANTHROPIC_API_KEY=... / OPENAI_API_KEY=...   # secret; required for that provider
OPENAI_BASE_URL=                     # OpenAI-compatible server: OpenVINO Model Server, IONOS; no key needed if set
LANGFUSE_PUBLIC_KEY=... / LANGFUSE_SECRET_KEY=...  # optional tracing; secret
LANGFUSE_HOST=

# Agent behaviour
DECISION_CONFIDENCE_THRESHOLD=0.9   # runs below this ask for clarification
MAX_CONCURRENT_ROUNDS=2             # analysis rounds at the same time; others wait
DATA_SHARING_POLICY=minimal          # minimal | adjacent | timeseries

# Data sources (IFF cluster DNS in production)
NGSI_URL=http://scorpio.iff-core.svc.cluster.local:9090
TIMESCALE_DB_URL=postgresql://...
POSTGRES_MEMORY_URL=postgresql://...
TIMESCALE_TABLE=attributes           # attribute history table
TIMESCALE_ENTITY_TABLE=entities      # entity lifecycle table
PGREST_URL=http://pgrest:3000        # the Data Explorer's history
FUSEKI_URL=http://fuseki:3030        # machine ontology and shapes
FUSEKI_DATASET=iff
FUSEKI_GRAPH_BASE=                   # http://<external host>/<realm> on the platform
MQTT_BROKER_URL=mqtt://emqx-listeners:1883       # live updates
MQTT_MGMT_URL=http://emqx-dashboard:18083
MQTT_BROKER_NOTIFY_URL=              # the MQTT broker as Scorpio reaches it, if different
WS_ALLOWED_ORIGINS=                  # other origins that may open the live updates stream
NGSI_TENANT=                         # optional NGSILD-Tenant
NGSI_CONTEXT_URL=                    # Link context; short names need it on data with full IRIs
ALERTA_URL=http://alerta:8080/api    # must end in /api
ALERTA_API_KEY=...                   # secret
ALERTS_REFRESH_INTERVAL_S=30         # the Alerts screen's default

# IFF Dataspace Gateway
GATEWAY_URL=http://...
GATEWAY_KEYCLOAK_URL=https://...
GATEWAY_KEYCLOAK_REALM=dataspace
GATEWAY_CLIENT_ID=...                # an operator's ifric_company_id claim comes first
GATEWAY_CLIENT_SECRET=...            # secret; optional, the operator can enter it; stored encrypted
SETTINGS_ENCRYPTION_KEY=...          # secret; required with GATEWAY_URL

# IFRIC Registry
IFRIC_URL=http://ifric-registry:4007  # including its port; asked with the dataspace token
FACTORY_ID=urn:ifric:...             # optional; PDT token claim is preferred

# Auth (Keycloak for FO operator login)
KEYCLOAK_URL=https://...
KEYCLOAK_REALM=...
KEYCLOAK_CLIENT_ID=scorpio           # use the IFF NGSI-LD broker client — its token carries ifric_factory_id and ifric_company_id provisioned by the data platform
CALLBACK_BASE_URL=https://...        # must be reachable from Scorpio
```

`get_llm()` in `app/config.py` is the single factory for LLM instantiation. Switching providers requires only two env var changes; no code changes.

---

## Deployment Architecture

XANA AI PDT uses a two-layer deployment model:

```
┌──────────────────────────────────────────────────────┐
│  Build layer (docker compose build / push)           │
│                                                      │
│  Dockerfile (backend/)  ──►  ghcr.io/…/backend:tag  │
│  Dockerfile (frontend/) ──►  ghcr.io/…/frontend:tag │
└──────────────────────────────────────────────────────┘
                        │
                        │ image pull
                        ▼
┌──────────────────────────────────────────────────────┐
│  Kubernetes cluster — namespace: iff                 │
│                                                      │
│  Ingress (nginx)                                     │
│       │                                              │
│       ▼                                              │
│  frontend Pod (unprivileged nginx)                   │
│  ├─ serves built React SPA                           │
│  ├─ proxy_pass /api/ → backend:8000 (upgrade)        │
│  └─ proxy_pass /ws/  → backend:8000 (upgrade)        │
│       │                                              │
│       ▼                                              │
│  backend Pod (python:3.12-slim)                      │
│  ├─ ConfigMap  → env (non-sensitive config)          │
│  └─ Secret     → env (API keys, DB passwords, etc.)  │
│                                                      │
└──────────────────────────────────────────────────────┘
                        │
         external IFF cluster services (DNS)
         Scorpio │ TimescaleDB │ PostgreSQL │ Alerta
         Keycloak │ Dataspace Gateway │ IFRIC Registry
```

The frontend's nginx configuration is part of its image, and takes the backend's address from `XANA_BACKEND_URL` at container start. A release goes in the platform's namespace by default, so it can read the database operator's generated Secret. See [`helm/README.md`](helm/README.md).

Deployment is managed with Helmfile 1.x:

```
helm/
├── helmfile.yaml.gotmpl            # release xana-pdt, environments
├── values.yaml.gotmpl              # bridges environment settings to the chart's values
├── environment/
│   ├── default.yaml                # platform service addresses, ingress
│   ├── production.yaml             # pinned image tag, TLS secret
│   └── local.yaml                  # a local cluster with stand-in services
├── test/                           # stand-in services and a smoke test, used by CI
└── charts/
    └── xana-pdt/                   # Helm chart (backend + frontend + ingress)
```


Not part of the current system: if the [`rag-tool`](#knowledge-base-rag-tool) knowledge base returns, it would be a second Helm release in the same namespace.

---

## Key Design Decisions

**Directed workflow over ReAct.** The agent follows a fixed path (OBSERVE → HYPOTHESIZE → VALIDATE → DECIDE → ACT) rather than an open tool-calling loop. This gives predictable, auditable behaviour suited to industrial diagnostics. Each step has a clear role and emits a typed WebSocket event.

**Confidence-gated decisions.** The decision confidence is derived from the top validated hypothesis score, not a separate LLM call, so the number shown in the UI and the number used for routing are always the same. Runs below the configured threshold pause and ask the operator for more information rather than committing a low-confidence diagnosis.

**Graceful degradation.** Every node catches tool exceptions and continues with whatever data is available. An unavailable NGSI broker or TimescaleDB does not abort the run — the LLM reasons over partial data.

**Structured output throughout.** All LLM responses are Pydantic-typed via `with_structured_output`. A normaliser validator on every `confidence` field accepts both `0.7` and `70` from the LLM and always stores a `[0, 1]` float. The UI never renders raw LLM text.

**Run persistence.** Every run that is not archived is written to the `runs` PostgreSQL table on every step and status change, before watchers hear of it, and restored into the in-memory manager on startup. Paused runs (`awaiting_input`, `awaiting_confirmation`, and later `awaiting_machine_builder`, `awaiting_operator_approval`) and finished but not yet archived runs survive backend restarts; a round in progress runs again from its start.

**Dataspace escalation.** Unresolved incidents can be escalated to the machine builder via the IFF Dataspace. The backend resolves the machine builder from the IFRIC registry, matches the gateway participant ID, enforces the data-sharing policy, and sends the NGSI-LD entity as a file-transfer and the incident summary as a structured message. A background inbox polling loop picks up replies automatically.

**Policy-enforced data sharing.** Every outbound file transfer passes through `apply_policy()` before the gateway call. The data-sharing policy tiers (`minimal`, `adjacent`, `timeseries`) map directly to the pre-negotiated IFF Dataspace capabilities (`twin:direct`, `twin:adjacents`, `twin:history`). If a machine builder requests data, within the configured tier or beyond it, the operator is asked to approve or decline before any additional data leaves the system.

**Single LLM factory.** `get_llm()` resolves the provider at call time from settings. Ollama is the default for local development; switching to Anthropic or OpenAI requires only an environment variable change.

**In-memory run manager with DB backing.** `RunManager` holds a `RunRecord` per run and is the primary source of truth for running state. `runs` in PostgreSQL provides persistence across restarts. For horizontal scaling, replace the manager's records with a shared store such as Redis.

**Event deduplication.** The event worker tracks active machine runs in a set. Duplicate events (e.g., Scorpio firing multiple times for the same machine) are dropped until the current run completes.
