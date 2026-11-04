# XANA AI PDT — Backend

Python 3.12 / FastAPI backend of XANA AI PDT. It is built in phases (issue #12). Today it provides:
- the service runtime: configuration, language model selection, and a health report of every dependency;
- the incident memory database and its migrations;
- a local environment with sample machine data.

See [`architecture.md`](../architecture.md) → Backend.

```
app/                 service: settings and get_llm(), health checks, API routes, memory migrations
migrations/          numbered .sql files, applied once each at startup
agent/               the xana-agent package: diagnostic agent workflow (installable on its own)
sample_data/         sample machine data (exported from the UI mock) and its loader
compose.yaml         local environment
```

## Local environment

Requirements: Docker with Compose. Run all commands from the repository root.

```bash
docker compose -f backend/compose.yaml up --build
```

This starts:

| Service | Purpose | Host port |
|---|---|---|
| `db` | PostgreSQL with TimescaleDB, holding the databases `memory`, `tsdb` and the broker's | 5432 |
| `broker` | Scorpio NGSI-LD context broker | 9090 |
| `ollama` | Language model server. `ollama-pull` downloads `LLM_MODEL` once (about 5 GB for `llama3.1`). | 11434 |
| `sample-data` | Loads the sample machines, components and sensors, and 24 hours of attribute history ending now. It runs once and keeps later changes. | — |
| `backend` | The backend, reloading on code changes | 8000 |

Data and models are kept in Docker volumes between runs. `docker compose -f backend/compose.yaml down -v` removes them.

**Without a model:** `LLM_PROVIDER=scripted docker compose -f backend/compose.yaml up --build` gives fixed answers and downloads no model.

**With a cloud model:** set `LLM_PROVIDER=anthropic` (or `openai`), `LLM_MODEL` and the API key in your shell.

**Ports in use:** if a host port is taken, set `XANA_DB_PORT`, `XANA_BROKER_PORT`, `XANA_OLLAMA_PORT` or `XANA_BACKEND_PORT`.

The local environment is for development only. The database trusts local connections, and every port is bound to `127.0.0.1`.

Check it:

```bash
curl 'http://localhost:8000/api/diagnostics?fresh=true'
```

Every check (memory, time-series store, context broker, language model) should be `ok`. While the model is still downloading, the language model check is `degraded`.

**With the UI:** in `frontend/`, run `npm run dev`. The development server forwards `/api` and `/ws` to `XANA_BACKEND_URL` (default `http://localhost:8000`).

## Configuration

All settings come from environment variables, or from `backend/.env` when the backend runs outside Docker. [`.env.example`](.env.example) lists every variable with its meaning and default.
- An invalid value stops the backend with a message naming the variable.
- Secrets are never shown: they are not in responses, logs or error messages, and connection URLs are shown with the password masked.

## Development

```bash
cd backend
python3.12 -m venv .venv
.venv/bin/pip install -e "./agent[anthropic,openai]" -e ".[dev]"
.venv/bin/python -m app            # needs the dependencies, e.g. the local environment's db, broker and ollama
```

## Tests and checks

```bash
cd backend
.venv/bin/ruff check . && .venv/bin/ruff format --check .
.venv/bin/pytest                   # agent package and service tests
```

- **Database tests:** tests marked `db` need PostgreSQL with TimescaleDB. Point `TEST_DATABASE_URL` at a server where the user may create databases, for example `TEST_DATABASE_URL=postgresql://xana@localhost:5432/postgres .venv/bin/pytest`. Without it they are skipped.
- **CI:** the `Backend` workflow runs linting, the formatting check, all tests including the database tests, and a check of `compose.yaml` on every pull request that touches `backend/`.

## Sample data

`sample_data/sample-data.json` is generated from the UI mock's seed, so the backend's machines are the ones the UI shows. Do not edit it by hand. After changing the seed, run `npx vite-node scripts/export-sample-data.mjs` in `frontend/`; a frontend test fails while the two differ.
