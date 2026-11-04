# XANA AI PDT — Architecture

## Purpose

XANA AI PDT (Process Digital Twin AI) is a stateful industrial diagnostic system. It observes machine and process state via NGSI-LD, reasons over anomalies using a structured LLM agent loop, and surfaces structured corrective actions through a dashboard UI.

It is not a chatbot. Every output is a typed, structured artifact: a hypothesis with a confidence score, a root cause, a recommended action, a logged incident.

---

## System Overview

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
│  pending_runs             │      │  embed query → pgvector       │
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
| System | Dependency health, service settings, knowledge-base documents |

**Data layer.** Screens obtain data only through the UI data interface (`src/data`), one module per area: session, runs, incidents, entities, alerts, dataspace, knowledge base, system health. A data source implements the interface and is selected with `VITE_DATA_SOURCE`:
- `mock` (default): runs in the browser with deterministic seeded data, a simulated run engine, and development controls for per-area latency and failure. No backend is needed.
- A backend adapter implementing the same interface talks to the API layer below over REST and WebSocket. Attaching it changes no screen.

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
- `src/app/`: router, session gate, header, entity references
- `src/ui/`: design tokens (CSS custom properties, dark and light themes, no CSS framework) and shared components
- `src/features/`: one folder per area

**Tests:** Vitest with Testing Library (components, data interface), Playwright with axe (end to end, accessibility), ESLint. The `Frontend` workflow runs them on every pull request that touches `frontend/`.

---

### Backend (`backend/`)

Python 3.12 + FastAPI, async throughout; database access with psycopg 3 (async).

The backend is delivered in phases (issue #12). This section describes the target; what exists today is the service runtime (configuration, language model factory, `GET /api/diagnostics`), the memory database migrations, the local environment and the diagnostic agent workflow package.

**Layout.** Two Python packages:

```
backend/
  app/                 service: config.py (settings, get_llm), health.py, api/, memory/
  migrations/          numbered .sql files, applied at startup
  agent/xana_agent/    diagnostic agent workflow and its tools: a package of its own,
                       installable and testable without the service
  sample_data/         sample machine data and its loader (local environment)
  compose.yaml         local environment
```

The agent package never imports the service. The service uses it like any other program would.

**Local environment.** `docker compose -f backend/compose.yaml up --build` starts PostgreSQL with TimescaleDB (databases `memory`, `tsdb` and the broker's), Scorpio, Ollama (pulling `LLM_MODEL` once), the backend on port 8000 and a one-off loader for the sample machine data. The sample data is exported from the UI mock's seed (`frontend/scripts/export-sample-data.mjs`), so machine identifiers agree between the UI and the backend. `LLM_PROVIDER=scripted` runs everything without downloading a model. The frontend development server forwards `/api` and `/ws` to `XANA_BACKEND_URL` (default `http://localhost:8000`). See `backend/README.md`.

#### API Layer (`app/api/`)

| Endpoint | Method | Description |
|---|---|---|
| `/api/agent/run` | POST | Start an agent run; returns `run_id` immediately (202) |
| `/api/agent/runs` | GET | List all active (non-terminal) runs |
| `/api/agent/status/{run_id}` | GET | Poll run status and accumulated steps |
| `/api/agent/clarify/{run_id}` | POST | Submit operator clarification to resume a paused run |
| `/api/agent/escalate/{run_id}` | POST | Escalate to machine builder via IFF Dataspace |
| `/api/agent/mb-feedback/{run_id}` | POST | Process a machine builder reply (called by inbox poller) |
| `/api/agent/operator-approve/{run_id}` | POST | Operator approves or declines an out-of-policy data request |
| `/api/agent/stop/{run_id}` | POST | Cancel an active or paused run |
| `/api/incidents` | GET | List past incidents from memory DB |
| `/api/incidents/{id}` | GET | Incident detail + full agent trace |
| `/api/diagnostics` | GET | Live connectivity check: PostgreSQL, TimescaleDB, Scorpio, Alerta, LLM |
| `/api/gateway/*` | — | Gateway token management and peer/capability inspection |
| `/api/ifric/*` | — | IFRIC registry token management and factory identity |
| `/ws/run/{run_id}` | WebSocket | Live stream of node updates; sentinel on completion or pause |
| `/events/ngsi` | POST | Webhook for Scorpio NGSI-LD notifications |
| `/events/alert` | POST | Webhook for external alert systems |

`RunRecord` (in `api/run_store.py`) is the central per-run state object. It holds the step list and a list of subscriber queues so multiple WebSocket clients can connect to the same run. The in-memory store (`run_store: dict[str, RunRecord]`) is sufficient for a single-process deployment; swap to Redis for horizontal scaling.

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

**Model calls.** Every call uses `with_structured_output`, a timeout of `LLM_TIMEOUT_S` and one retry when the answer does not match the structure. A timeout or a second mismatch fails the round with the step and a readable reason. Prompts (`agent/xana_agent/prompts/`) pass every value as JSON in a named section; operator text is marked as data, never as instructions.

**Read-only.** Sources only read: the context source sends GET requests, the history source runs read-only transactions. The validation plan is limited to the entities observed in the round, so text in the issue cannot widen what is read. Memory is written only by `act`.

**Escalation flow.** When the operator clicks "Escalate to machine builder":

```
POST /api/agent/escalate/{run_id}
  │
  ├─ IFRIC lookup: GET /company/products/{machine_id} → company_ifric_id, company_name
  ├─ Gateway peer match: GET /participants/compatible
  ├─ Policy check (apply_policy): enforce DATA_SHARING_POLICY before sending
  │    → emits policy_check step event over WebSocket
  ├─ File transfer: POST /outbox/files (NGSI-LD entity as JSON; message_type=file-transfer)
  ├─ Structured message: POST /outbox/messages (incident payload; message_type=request)
  └─ Run transitions to awaiting_machine_builder
```

**Inbox polling.** A background `asyncio` task polls `GET /inbox/messages?status=received` every 30 seconds. When a message arrives whose `conversation_id` matches a pending escalation, `machine_builder_feedback` is invoked automatically.

**Policy-gated data sharing.** When a machine builder reply arrives:

```
machine_builder_feedback
  │
  ├─ LLM review: classify what data types the MB is requesting
  ├─ within policy?
  │    ├─ YES → policy_check step → send approved files → run stays in awaiting_machine_builder
  │    └─ NO  → run transitions to awaiting_operator_approval
  │                 │
  │                 └─ operator approves → policy_check step → send allowed files
  │                    operator declines → refusal message sent to MB
```

Data-sharing tiers mirror the pre-negotiated IFF Dataspace capabilities:

| Policy | Capability | Data sent |
|---|---|---|
| `minimal` | `twin:direct` | Single NGSI-LD entity (always sent on escalation) |
| `adjacent` | `twin:adjacents` | Entity + directly linked component entities |
| `timeseries` | `twin:history` | Above + time-series signal history |

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

`testing.py` provides fake sources and scripted answers for every step; the scripted provider (`LLM_PROVIDER=scripted`) uses them, so a complete run works without a model. Alerts, dataspace gateway and IFRIC sources are not part of phase 1.

#### Knowledge Base (`rag-tool`)

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
-- 001_init.sql
incidents (
    id          SERIAL PRIMARY KEY,
    machine_id  TEXT,
    issue       TEXT,
    root_cause  TEXT,
    resolution  TEXT,
    timestamp   TIMESTAMPTZ
)

agent_traces (
    id          SERIAL PRIMARY KEY,
    incident_id INT REFERENCES incidents(id) ON DELETE CASCADE,
    step        INT,
    action      TEXT,      -- OBSERVE | HYPOTHESIZE | VALIDATE | DECIDE | ACT
    input       JSONB,
    output      JSONB,
    timestamp   TIMESTAMPTZ
)

-- 002_pending_runs.sql
pending_runs (
    run_id                  TEXT PRIMARY KEY,
    status                  TEXT NOT NULL,  -- awaiting_input | awaiting_machine_builder | awaiting_operator_approval
    machine_id              TEXT NOT NULL DEFAULT '',
    issue_summary           TEXT NOT NULL DEFAULT '',
    created_at              TIMESTAMPTZ NOT NULL,
    steps                   JSONB NOT NULL DEFAULT '[]',
    final_state             JSONB,
    clarification_message   TEXT,
    clarification_confidence FLOAT
)
```

`pending_runs` is the persistence backing for open runs. On each transition to a non-terminal state (`awaiting_input`, `awaiting_machine_builder`, `awaiting_operator_approval`), the run is upserted into this table. On completion, failure, or stop it is deleted. At startup the backend restores all rows into the in-memory `run_store` so open incidents survive a backend restart.

`app/memory/migrate.py` maintains a `schema_migrations` tracking table and applies `.sql` files in lexicographic order. Idempotent — safe to call on every startup.

---

## Data Layer

| Store | Purpose | Access pattern |
|---|---|---|
| **Scorpio (NGSI-LD)** | Live machine context, relationships | HTTP via NGSI-LD v1 API |
| **TimescaleDB** | Attribute history (signals and telemetry) | SQL via psycopg 3; `time_bucket` for aggregation |
| **PostgreSQL** | AI memory: incidents + agent traces | SQL via psycopg 3 |
| **Alerta** | Active alerts and alarm history | HTTP via Alerta REST API (`Authorization: Key`) |

The backend reads attribute history in the layout the IFF Digital Twin platform writes: one row per observed attribute value, in a table named by `TIMESCALE_TABLE` (default `attributes`):
```sql
attributes ("observedAt" TIMESTAMPTZ, "entityId" TEXT, "attributeId" TEXT, "attributeType" TEXT,
            "nodeType" TEXT, "value" TEXT, "valueType" TEXT, "datasetId" TEXT, "deleted" BOOLEAN)
```
The local environment creates this table and fills it with 24 hours of sample history ending at load time.

---

## Configuration

All backend configuration is via environment variables, read by `pydantic-settings` (`app/config.py`).

In **production** (K8s), non-sensitive config comes from a Helm-rendered ConfigMap and sensitive values from a Secret — both injected as `envFrom` in the backend Deployment. See `helm/charts/xana-pdt/templates/backend-configmap.yaml` and `backend-secret.yaml`.

For **local development**, copy `backend/.env.example` to `backend/.env` and fill in credentials. `backend/.env.example` lists every variable the backend reads, with its default; an invalid value stops the backend at startup with a message naming the variable (never its value). Secrets are never returned or logged; connection URLs are shown with the password masked.

Key variable groups (gateway, IFRIC and sign-in variables belong to later phases):

```
# LLM
LLM_PROVIDER=ollama                  # ollama | anthropic | openai | scripted (fixed answers, no model)
LLM_MODEL=llama3.1
OLLAMA_URL=http://...
LLM_TIMEOUT_S=120
ANTHROPIC_API_KEY=... / OPENAI_API_KEY=...   # secret; required for that provider

# Agent behaviour
DECISION_CONFIDENCE_THRESHOLD=0.9   # runs below this ask for clarification
DATA_SHARING_POLICY=minimal          # minimal | adjacent | timeseries

# Data sources (IFF cluster DNS in production)
NGSI_URL=http://scorpio.iff-core.svc.cluster.local:9090
TIMESCALE_DB_URL=postgresql://...
POSTGRES_MEMORY_URL=postgresql://...
TIMESCALE_TABLE=attributes           # attribute history table
NGSI_TENANT=                         # optional NGSILD-Tenant
ALERTA_URL=http://...
ALERTA_API_KEY=...                   # secret

# IFF Dataspace Gateway
GATEWAY_URL=http://...
GATEWAY_KEYCLOAK_URL=https://...
GATEWAY_KEYCLOAK_REALM=...
GATEWAY_CLIENT_ID=...
GATEWAY_CLIENT_SECRET=...            # secret

# IFRIC Registry
IFRIC_URL=https://dev-registry.ifric.org
IFRIC_REFRESH_TOKEN=...              # secret (Supabase service role key)
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
│  Kubernetes cluster — namespace: xana-ai-pdt         │
│                                                      │
│  Ingress (nginx)                                     │
│       │                                              │
│       ▼                                              │
│  frontend Pod (nginx:alpine)                         │
│  ├─ serves built React SPA                           │
│  ├─ proxy_pass /api/ → backend:8000                  │
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

The frontend nginx config is rendered as a K8s ConfigMap at deploy time (`frontend-configmap.yaml`), which injects the backend service DNS name (`xana-pdt-backend:8000`) so the proxy target is never hardcoded in the image.

Deployment is managed with Helmfile 1.7.x:

```
helm/
├── helmfile.yaml.gotmpl            # releases (xana-pdt + rag-tool), environments
├── values.yaml.gotmpl              # bridges env vars to xana-pdt chart values
├── values-rag-tool.yaml.gotmpl     # bridges env vars to rag-tool chart values
├── environment/
│   ├── default.yaml                # IFF cluster URLs, ingress host, ragTool* keys
│   └── production.yaml             # pinned image tag, TLS secret
└── charts/
    ├── xana-pdt/                    # single Helm chart (backend + frontend + ingress)
    └── rag-tool/                    # second Helm chart (rag-tool knowledge base)
```

The [`rag-tool`](#knowledge-base-rag-tool) knowledge base
is a **second Helm release** (chart at
`helm/charts/rag-tool`), appended to the same
`helmfile.yaml.gotmpl` and deployed into the **same** `xana-ai-pdt`
namespace, so it shares this app's Ingress (an extra `/mcp` path routed to
the `rag-tool-mcp` Service) and Postgres cluster (its own dedicated `rag`
database, alongside `tsdb`/`memory`) rather than provisioning its own. See
[`rag-tool-microservice/docs/kubernetes.md`](rag-tool-microservice/docs/kubernetes.md)
for the full deployment walkthrough, including creating the `rag` database.

---

## Key Design Decisions

**Directed workflow over ReAct.** The agent follows a fixed path (OBSERVE → HYPOTHESIZE → VALIDATE → DECIDE → ACT) rather than an open tool-calling loop. This gives predictable, auditable behaviour suited to industrial diagnostics. Each step has a clear role and emits a typed WebSocket event.

**Confidence-gated decisions.** The decision confidence is derived from the top validated hypothesis score, not a separate LLM call, so the number shown in the UI and the number used for routing are always the same. Runs below the configured threshold pause and ask the operator for more information rather than committing a low-confidence diagnosis.

**Graceful degradation.** Every node catches tool exceptions and continues with whatever data is available. An unavailable NGSI broker or TimescaleDB does not abort the run — the LLM reasons over partial data.

**Structured output throughout.** All LLM responses are Pydantic-typed via `with_structured_output`. A normaliser validator on every `confidence` field accepts both `0.7` and `70` from the LLM and always stores a `[0, 1]` float. The UI never renders raw LLM text.

**Run persistence.** Open runs (`awaiting_input`, `awaiting_machine_builder`, `awaiting_operator_approval`) are upserted into the `pending_runs` PostgreSQL table on every state transition and restored into the in-memory store on startup. Active incidents survive backend restarts.

**Dataspace escalation.** Unresolved incidents can be escalated to the machine builder via the IFF Dataspace. The backend resolves the machine builder from the IFRIC registry, matches the gateway participant ID, enforces the data-sharing policy, and sends the NGSI-LD entity as a file-transfer and the incident summary as a structured message. A background inbox polling loop (30 s interval) picks up replies automatically.

**Policy-enforced data sharing.** Every outbound file transfer passes through `apply_policy()` before the gateway call. The data-sharing policy tiers (`minimal`, `adjacent`, `timeseries`) map directly to the pre-negotiated IFF Dataspace capabilities (`twin:direct`, `twin:adjacents`, `twin:history`). If a machine builder requests data beyond the configured tier, the operator is asked to approve or decline before any additional data leaves the system.

**Single LLM factory.** `get_llm()` resolves the provider at call time from settings. Ollama is the default for local development; switching to Anthropic or OpenAI requires only an environment variable change.

**In-memory run store with DB backing.** `run_store: dict[str, RunRecord]` is the primary source of truth for running state. `pending_runs` in PostgreSQL provides persistence across restarts. For horizontal scaling, replace `run_store` with a Redis-backed store.

**Event deduplication.** The event worker tracks active machine runs in a set. Duplicate events (e.g., Scorpio firing multiple times for the same machine) are dropped until the current run completes.
