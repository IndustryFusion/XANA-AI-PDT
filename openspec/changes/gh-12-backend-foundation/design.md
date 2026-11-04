# Design

## Context

See proposal.md → Why. The repository has `frontend/` (operator UI on a mock data source) and no `backend/`. `architecture.md` → Backend describes the target: Python 3.12 and FastAPI, a LangGraph agent in `app/agent/`, tools in `app/tools/`, memory in PostgreSQL, configuration via `pydantic-settings` and one `get_llm()` factory. Issue #12 asks for the agent workflow to be a package of its own, for the backend to run fully on a developer machine including the language model, and for four changes. This change provides the frame; `gh-12-agent-workflow`, `gh-12-run-api` and `gh-12-ui-backend-source` fill it.

## Goals / Non-Goals

**Goals:**
- A service skeleton and conventions (layout, configuration, tests, lint, CI) that the next three changes follow without new decisions.
- A local environment in which a contributor can try the complete phase 1 without factory access or a GPU.
- Honest health reporting: a missing dependency is visible, never fatal.

**Non-Goals:**
- Production deployment (images, Helm). The local image is a development artefact.
- Authentication. Phase 1 has no sign-in; the UI's session area stays on the mock (`gh-12-ui-backend-source`).

## Decisions

### 1. Two Python packages in `backend/`
```
backend/
  pyproject.toml          service package "xana-backend" (imports app); depends on xana-agent
  app/
    main.py               application factory, startup and shutdown
    config.py             settings, language model factory
    health.py             dependency checks
    memory/               connection pool, migration runner
    api/                  HTTP and WebSocket routes (diagnostics now; runs and incidents in gh-12-run-api)
  migrations/             numbered .sql files
  agent/
    pyproject.toml        workflow package "xana-agent" (imports xana_agent); no web framework dependency
    xana_agent/           workflow, tools, typed results (gh-12-agent-workflow)
    tests/
  sample_data/            sample entities and the loader
  tests/
  compose.yaml            local environment
  Dockerfile              local image
  .env.example
```
The issue asks for the agent workflow as "a package itself": it can be installed, imported and tested without the service. This change only creates the empty package and its test setup.

*Conflict with `architecture.md`:* it places the agent in `app/agent/` and the tools in `app/tools/`, inside the service. Here, both move into `backend/agent/xana_agent/`, and `architecture.md` → Backend is updated accordingly.

*Alternatives:*
- Keep `app/agent/` and only enforce with a lint rule that it does not import the API. This is lighter, but the agent cannot be installed or versioned on its own.
- A separate repository for the agent. This adds release coordination before there is a second consumer.

### 2. Tooling
- Python 3.12. Each package has a `pyproject.toml` installed with `pip` (`pip install -e backend/agent -e backend[dev]`).
- Ruff for linting and formatting checks.
- Pytest with pytest-asyncio for tests.

*Alternatives:*
- uv or Poetry: faster or more complete dependency management, but one more tool for contributors to install. Can be adopted later without code changes.
- flake8 plus black: two tools where Ruff covers both.

### 3. Runtime dependencies
- **Service:** `fastapi`, `uvicorn[standard]`, `pydantic-settings`, `httpx` (context broker, health checks), `psycopg[binary,pool]` (PostgreSQL and TimescaleDB).
- **Agent package:** `langgraph`, `langchain-core` and `langchain-ollama`. `langchain-anthropic` and `langchain-openai` are optional extras that the local image installs.

`architecture.md` names `psycopg2` with `asyncio.to_thread`. Psycopg 3 is chosen instead: it is the maintained successor, offers native async and a connection pool, and avoids a thread hop per query. *Alternative:* `psycopg2` as written, at the cost of threads and no built-in async pool.

### 4. Configuration
- One settings object read from the environment and from `backend/.env` when that file exists.
- Every non-secret value has a default; secrets are typed as secret, so they never appear in `repr`, logs or responses.
- Validation errors stop startup with the variable name and the reason.
- Connection URLs are masked (`postgresql://user:***@host/db`) wherever they are reported.

The variables:

| Variable | Default | Purpose |
|---|---|---|
| `LLM_PROVIDER` | `ollama` | One of `ollama`, `anthropic`, `openai`, `scripted` |
| `LLM_MODEL` | `llama3.1` | Model name for the chosen provider |
| `OLLAMA_URL` | `http://localhost:11434` | Local model server |
| `ANTHROPIC_API_KEY` | — | Secret; required for `anthropic` |
| `OPENAI_API_KEY` | — | Secret; required for `openai` |
| `OPENAI_BASE_URL` | — | Optional, for OpenAI-compatible servers |
| `LLM_TIMEOUT_S` | `120` | Timeout of one model call |
| `DECISION_CONFIDENCE_THRESHOLD` | `0.9` | Value 0 to 1; used from `gh-12-agent-workflow` on |
| `NGSI_URL` | `http://localhost:9090` | NGSI-LD context broker |
| `NGSI_TENANT` | — | Optional `NGSILD-Tenant` |
| `TIMESCALE_DB_URL` | `postgresql://xana@localhost:5432/tsdb` | Time-series store; may contain a password |
| `TIMESCALE_TABLE` | `attributes` | Attribute history table (decision 6) |
| `POSTGRES_MEMORY_URL` | `postgresql://xana@localhost:5432/memory` | Memory database; may contain a password |
| `HEALTH_TIMEOUT_S` | `3` | Per-check timeout |
| `HEALTH_CACHE_S` | `10` | Reuse a health report for this long |
| `LOG_LEVEL` | `INFO` | Log level |

### 5. Language model factory and the scripted provider
`get_llm()` in `app/config.py` is the only place that creates a model, as `architecture.md` requires. It returns a chat model of the configured provider.

`scripted` is a small in-house chat model:
- It answers structured-output requests with a fixed, valid instance of the requested schema, taken from registered example answers or derived from the schema.
- It answers plain requests with fixed text.

It exists so that CI, contributors without a GPU, and demos can run the whole flow. It is labelled as scripted in the health report (detail "scripted answers, no model"), so nobody mistakes it for a real diagnosis.

The language model health check works as follows:
- `ollama`: lists the server's models and verifies that the configured model is present.
- Cloud providers: a minimal model-list call.
- `scripted`: always `ok`.

*Alternatives:* mock the model only inside tests. This would leave no model-free way to run the local environment or end-to-end tests.

### 6. Time-series layout
`architecture.md` → Data Layer assumes a `signals(time, machine_id, signal_id, metric, value)` table. The IFF Digital Twin platform, which feeds TimescaleDB in a factory, writes one row per attribute observation instead: entity ID, attribute ID, observed time, value, value type and node type.

Phase 1 reads that layout, with the table name configurable (`TIMESCALE_TABLE`), so the same backend works against a factory installation and the local environment. `architecture.md` → Data Layer is updated.

*Alternative:* the `signals` table as written. A factory installation would then need an extra pipeline.

### 7. Migrations
A small runner applies `backend/migrations/NNN_name.sql` in lexicographic order:
- Each file runs in its own transaction.
- The runner records each file in a `schema_migrations` table.
- It holds a PostgreSQL advisory lock while running, so two backend processes cannot apply the same file.

The runner starts at startup. If the database is unreachable then, it runs from the memory health check until it succeeds.

This change adds only `001_schema_migrations.sql`. The runs and incidents tables come with `gh-12-run-api`.

*Alternative:* Alembic. It is more capable, but needs a Python migration environment and models for what are a few plain SQL files; `architecture.md` already describes plain SQL migrations.

### 8. Health checks
The four checks run concurrently, each with `HEALTH_TIMEOUT_S`:

| Check | Probe |
|---|---|
| Memory | Connect and `SELECT 1`, plus migration status |
| Time-series | Connect and confirm the attribute table exists |
| Context broker | `GET /ngsi-ld/v1/types` |
| Language model | See decision 5 |

`GET /api/diagnostics?fresh=true|false` returns:

```
{ overall, checked_at, checks: [{ id, label, status, latency_ms, detail }] }
```

The result is cached for `HEALTH_CACHE_S`. The overall rule matches the UI's (`ok`, `degraded`, `error`). Field names are snake_case; the frontend adapter maps them (`gh-12-ui-backend-source`).

### 9. Local environment
`backend/compose.yaml` defines these services:

| Service | Contents |
|---|---|
| `db` | TimescaleDB image that includes PostGIS. One server with the databases `memory`, `tsdb` and the broker's own database, created by an init script. |
| `broker` | Scorpio all-in-one, the NGSI-LD broker IFF uses, on port 9090, backed by `db` |
| `ollama` | Model server. A one-off `ollama-pull` service pulls `LLM_MODEL` into a named volume. |
| `sample-data` | One-off loader (decision 10) |
| `backend` | Built from `backend/Dockerfile` with reload enabled, port 8000 |

How to run it:
- The documented command is `docker compose -f backend/compose.yaml up`.
- `LLM_PROVIDER=scripted` together with the `no-model` profile skips Ollama.
- Named volumes keep the data and models between runs.

The frontend development server proxies `/api` and `/ws`, with WebSocket upgrade, to `XANA_BACKEND_URL` (default `http://localhost:8000`).

*Alternatives:*
- A Kubernetes setup such as k3d. It is closer to production, but heavy for a first contact.
- A lightweight broker instead of Scorpio. It would behave differently from what factories run.

### 10. Sample data shared with the UI mock
The UI mock already has a deterministic factory: machines, components and relationships.
- A frontend script exports these entities as NGSI-LD JSON into `backend/sample_data/entities.json`. A frontend test fails if the file differs from the current seed, so the two cannot drift apart.
- The backend loader upserts the entities into the broker. It then writes 24 hours of attribute history for every numeric property into the time-series table, at 5-minute intervals ending at load time, with deterministic variation.
- A marker row makes the history load happen once.

Because the identifiers match, a machine picked in the UI while the data explorer still runs on the mock (phase 1) exists in the backend.

*Alternatives:*
- Hand-written backend sample data: two datasets that drift.
- Reading the JS seed from Python: a JS runtime inside the backend.

### 11. Tests and CI
- Unit tests need no services.
- Tests marked `db` need PostgreSQL with TimescaleDB, reached through `TEST_DATABASE_URL`. They are skipped when that variable is not set.
- The `Backend` workflow runs on pull requests touching `backend/**`. In a TimescaleDB service container it runs: `ruff check`, `ruff format --check`, the agent package tests, the service tests including the `db` tests, and `docker compose config` on the local environment file.

## Risks / Trade-offs

- **Model download size:** about 5 GB for `llama3.1`. Mitigation: the scripted provider and the `no-model` profile; the model name is configurable for smaller models.
- **Local model quality:** a small local model gives weaker diagnoses than a cloud model. Mitigation: switching provider takes two variables.
- **Broker startup time:** Scorpio needs tens of seconds to start. Mitigation: health-based ordering in compose; the loader waits and retries.
- **Shared sample data couples frontend and backend:** this is accepted. The drift test makes the coupling explicit.

## Open Questions

- Default local model: `llama3.1` (8B) is assumed. A maintainer may prefer a smaller default.
