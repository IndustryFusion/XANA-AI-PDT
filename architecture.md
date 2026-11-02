# XANA AI PDT — Architecture

## Purpose

XANA AI PDT (Process Digital Twin AI) is a stateful industrial diagnostic system. It observes machine and process state via NGSI-LD, reasons over anomalies using a structured LLM agent loop, and surfaces structured corrective actions through a dashboard UI.

It is not a chatbot. Every output is a typed, structured artifact: a hypothesis with a confidence score, a root cause, a recommended action, a logged incident.

---

## System Overview

```
┌─────────────────────────────────────────────────────────────────────────┐
│  Frontend (React + Vite)                                                │
│  ContextView │ AIPanel │ IncidentTimeline │ Diagnostics                 │
│  ClarificationPanel │ MachineBuilderPanel │ OperatorApprovalPanel       │
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

Built with React 18 + Vite. Three panels, no chat interface.

| Component | Responsibility |
|---|---|
| `ContextView` | Form to submit a `machine_id` and `issue`; disabled while a run is active |
| `AIPanel` | Live step feed, hypothesis confidence cards, decision card, and escalation panels |
| `ClarificationPanel` | Shown when confidence < threshold; operator submits additional info to resume the run |
| `MachineBuilderPanel` | Shown while waiting for machine builder reply via dataspace |
| `OperatorApprovalPanel` | Shown when a MB data request exceeds the data-sharing policy; operator approves or declines |
| `IncidentTimeline` | Scrollable list of past incidents; click to expand with full agent trace |

**Data flow in the frontend:**
1. User submits → `POST /api/agent/run` → receives `run_id`
2. WebSocket opens on `/ws/run/{run_id}`
3. Each completed agent node streams a structured update message
4. Run enters one of several possible states:
   - **`completed`** — incident logged; sentinel closes the connection
   - **`awaiting_input`** — confidence below threshold; `ClarificationPanel` appears; operator submits text/files → `POST /api/agent/clarify/{run_id}` → run resumes
   - **`awaiting_machine_builder`** — escalated via dataspace; `MachineBuilderPanel` appears; inbox poller checks for MB reply every 30 s
   - **`awaiting_operator_approval`** — MB replied with a data request exceeding policy; `OperatorApprovalPanel` appears; operator approves/declines → `POST /api/agent/operator-approve/{run_id}`

**Key files:**
- `src/hooks/useWebSocket.js` — manages WS lifecycle, separates node messages from final sentinel
- `src/hooks/useIncidents.js` — fetches incident list and detail; accepts a `refreshKey` to reload after a completed run
- `src/api/client.js` — thin fetch wrappers for all API endpoints
- `src/App.css` — dark industrial theme using CSS variables, no framework

---

### Backend (`backend/`)

Python 3.12 + FastAPI. All async at the HTTP layer; sync DB calls wrapped in `asyncio.to_thread`.

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

#### Agent Runtime (`app/agent/`)

A LangGraph `StateGraph` with six nodes, compiled once at startup.

```
observe → hypothesize → retrieve → validate → decide ──(confidence ≥ threshold)──→ act → END
                                                   │
                                                   ├──(confidence < threshold)──→ END [awaiting_input]
                                                   └──(operator confirmation pending)──→ END [awaiting_confirmation]
```

After `act` completes (incident logged), or when confidence is too low, the run transitions to a terminal or paused state handled outside the graph by the API layer.

| Node | Tools called | LLM call | Output added to state |
|---|---|---|---|
| `observe` | `ngsi_get_entity`, `ngsi_traverse_relationships`, `timescale_fetch_recent`, `alerta_list_alerts` | No | `entities`, `signals`, `alerta_alerts` |
| `hypothesize` | — | Yes (structured output: `HypothesisList`) | `hypotheses` |
| `retrieve` | `rag_retrieve()` (HTTP to retrieval-service) | Yes (query planning: decompose hypotheses into search queries) | `rag_queries`, `rag_context` |
| `validate` | `timescale_query_metrics` | Yes (structured output: `ValidatedHypothesisList`; `rag_context` injected into prompt) | `validated_hypotheses` |
| `decide` | `memory_find_similar_incidents` | Yes (structured output: `Decision`; `rag_context` injected into prompt) | `root_cause`, `recommended_action`, `confidence`, `past_incidents` |
| `act` | `memory_store_incident`, `memory_log_trace` | No | `incident_id` |

**Confidence routing.** The `decide` node sets `confidence` to the highest validated hypothesis confidence score (not a separate LLM assessment). If `confidence < DECISION_CONFIDENCE_THRESHOLD` (default 0.9), `awaiting_input` is set to `True` and the graph routes to `END` without calling `act`. The API layer transitions the run to `awaiting_input` and prompts the operator for more information.

**Clarification loop.** When the operator submits additional context (`POST /api/agent/clarify/{run_id}`), the extra information is appended to the issue and the full graph re-runs from `observe`. The run can cycle through multiple clarification rounds until confidence is sufficient or the operator escalates.

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

Every node catches tool exceptions and continues with partial data — a missing NGSI or Timescale connection degrades gracefully rather than crashing the run. State is a plain `TypedDict` (`AgentState`); each node returns a full merged copy.

LLM structured output uses Pydantic models (`app/agent/schemas.py`) passed to `llm.with_structured_output(...)`. All confidence fields include a normaliser validator that accepts both `0.7` and `70` from the LLM and always stores a `[0, 1]` float. The LLM provider is resolved at call time via `get_llm()` — see Configuration section.

#### Tool Layer (`app/tools/`)

All tools are LangChain `@tool`-decorated functions with Pydantic `args_schema`. They are directly usable by the agent or callable standalone.

| Module | Tools | Backend |
|---|---|---|
| `tools/ngsi.py` | `ngsi_get_entity`, `ngsi_query_entities`, `ngsi_traverse_relationships` | `httpx` HTTP to Scorpio |
| `tools/timescale.py` | `timescale_fetch_recent`, `timescale_query_metrics` | `psycopg2` to TimescaleDB |
| `tools/memory.py` | `memory_find_similar_incidents`, `memory_store_incident`, `memory_log_trace` | `psycopg2` to PostgreSQL |
| `tools/alerta.py` | `alerta_list_alerts`, `alerta_get_alert`, `alerta_action` | `httpx` HTTP to Alerta (`Authorization: Key`) |
| `tools/gateway.py` | `gateway_send_message`, `gateway_send_files_raw`, `gateway_list_inbox`, `gateway_ack_message`, `gateway_list_compatible_peers`, capability tools | `httpx` HTTP to IFF Dataspace Gateway |
| `tools/ifric.py` | `lookup_machine_builder` | `httpx` HTTP to IFRIC Registry |

`ALL_TOOLS` in `tools/__init__.py` exports a flat list for easy wiring into future ReAct-style agents.

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
| **TimescaleDB** | Time-series signals and telemetry | SQL via `psycopg2`; `time_bucket` for aggregation |
| **PostgreSQL** | AI memory: incidents + agent traces | SQL via `psycopg2` |
| **Alerta** | Active alerts and alarm history | HTTP via Alerta REST API (`Authorization: Key`) |

TimescaleDB is assumed to have a `signals` table:
```sql
signals (time TIMESTAMPTZ, machine_id TEXT, signal_id TEXT, metric TEXT, value DOUBLE PRECISION)
```

---

## Configuration

All backend configuration is via environment variables, read by `pydantic-settings` (`app/config.py`).

In **production** (K8s), non-sensitive config comes from a Helm-rendered ConfigMap and sensitive values from a Secret — both injected as `envFrom` in the backend Deployment. See `helm/charts/xana-pdt/templates/backend-configmap.yaml` and `backend-secret.yaml`.

For **local development**, copy `backend/.env.example` to `backend/.env` and fill in credentials.

Key variable groups:

```
# LLM
LLM_PROVIDER=ollama                  # ollama | anthropic | openai
LLM_MODEL=llama3.1
OLLAMA_URL=http://...

# Agent behaviour
DECISION_CONFIDENCE_THRESHOLD=0.9   # runs below this ask for clarification
DATA_SHARING_POLICY=minimal          # minimal | adjacent | timeseries

# Data sources (IFF cluster DNS in production)
NGSI_URL=http://scorpio.iff-core.svc.cluster.local:9090
TIMESCALE_DB_URL=postgresql://...
POSTGRES_MEMORY_URL=postgresql://...
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

**Directed workflow over ReAct.** The agent follows a fixed six-step path (OBSERVE → HYPOTHESIZE → RETRIEVE → VALIDATE → DECIDE → ACT) rather than an open tool-calling loop. This gives predictable, auditable behaviour suited to industrial diagnostics. Each step has a clear role and emits a typed WebSocket event. The `retrieve` step queries the RAG knowledge base (equipment manuals, procedures) and injects relevant chunks into the `validate` and `decide` prompts, grounding LLM reasoning in document evidence without expanding the tool-calling surface.

**Confidence-gated decisions.** The decision confidence is derived from the top validated hypothesis score, not a separate LLM call, so the number shown in the UI and the number used for routing are always the same. Runs below the configured threshold pause and ask the operator for more information rather than committing a low-confidence diagnosis.

**Graceful degradation.** Every node catches tool exceptions and continues with whatever data is available. An unavailable NGSI broker or TimescaleDB does not abort the run — the LLM reasons over partial data.

**Structured output throughout.** All LLM responses are Pydantic-typed via `with_structured_output`. A normaliser validator on every `confidence` field accepts both `0.7` and `70` from the LLM and always stores a `[0, 1]` float. The UI never renders raw LLM text.

**Run persistence.** Open runs (`awaiting_input`, `awaiting_machine_builder`, `awaiting_operator_approval`) are upserted into the `pending_runs` PostgreSQL table on every state transition and restored into the in-memory store on startup. Active incidents survive backend restarts.

**Dataspace escalation.** Unresolved incidents can be escalated to the machine builder via the IFF Dataspace. The backend resolves the machine builder from the IFRIC registry, matches the gateway participant ID, enforces the data-sharing policy, and sends the NGSI-LD entity as a file-transfer and the incident summary as a structured message. A background inbox polling loop (30 s interval) picks up replies automatically.

**Policy-enforced data sharing.** Every outbound file transfer passes through `apply_policy()` before the gateway call. The data-sharing policy tiers (`minimal`, `adjacent`, `timeseries`) map directly to the pre-negotiated IFF Dataspace capabilities (`twin:direct`, `twin:adjacents`, `twin:history`). If a machine builder requests data beyond the configured tier, the operator is asked to approve or decline before any additional data leaves the system.

**Single LLM factory.** `get_llm()` resolves the provider at call time from settings. Ollama is the default for local development; switching to Anthropic or OpenAI requires only an environment variable change.

**In-memory run store with DB backing.** `run_store: dict[str, RunRecord]` is the primary source of truth for running state. `pending_runs` in PostgreSQL provides persistence across restarts. For horizontal scaling, replace `run_store` with a Redis-backed store.

**Event deduplication.** The event worker tracks active machine runs in a set. Duplicate events (e.g., Scorpio firing multiple times for the same machine) are dropped until the current run completes.
