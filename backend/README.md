# XANA AI PDT — Backend

Python 3.12 / FastAPI backend of XANA AI PDT. It is built in phases (issue #12). Today it provides:
- the service runtime: configuration, language model selection, and a health report of every dependency;
- sign-in through Keycloak, and the operator's token for the context broker ([Sign-in](#sign-in));
- the incident memory database and its migrations;
- runs that operators start, clarify, confirm or reject, stop and archive, with a live stream and the incident history ([API](#api));
- a local environment with sample machine data;
- the diagnostic agent workflow as a package of its own ([`agent/README.md`](agent/README.md)).

See [`architecture.md`](../architecture.md) → Backend.

```
app/                 service: settings and get_llm(), health checks, API routes, memory migrations
  api/               HTTP and WebSocket routes, error shape
  runs/              run manager: lifecycle, rounds in the background, stream subscribers
  memory/            migrations, run and incident storage, the workflow's incident memory
migrations/          numbered .sql files, applied once each at startup
agent/               the xana-agent package: diagnostic agent workflow, installable and usable on its own
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

**Without a model:** `LLM_PROVIDER=scripted docker compose -f backend/compose.yaml up --build` gives fixed answers and downloads no model: each run asks one question, and proposes a diagnosis once the operator has clarified.

**With a cloud model:** set `LLM_PROVIDER=anthropic` (or `openai`), `LLM_MODEL` and the API key in your shell.

**With OpenVINO Model Server or another OpenAI-compatible server:** set `LLM_PROVIDER=openai`, `OPENAI_BASE_URL` (for OpenVINO Model Server, its `/v3` address), `LLM_MODEL`, and optionally `LLM_PROVIDER_NAME=OpenVINO`. An API key is needed only if the server asks for one.

**With sign-in:** `KEYCLOAK_URL=http://keycloak:8080 docker compose -f backend/compose.yaml --profile auth up --build`. Sign in as `operator` with password `operator`. The realm in `keycloak/` is for development only.

**Ports in use:** if a host port is taken, set `XANA_DB_PORT`, `XANA_BROKER_PORT`, `XANA_OLLAMA_PORT`, `XANA_KEYCLOAK_PORT` or `XANA_BACKEND_PORT`.

The local environment is for development only. The database trusts local connections, and every port is bound to `127.0.0.1`.

Check it:

```bash
curl 'http://localhost:8000/api/diagnostics?fresh=true'
```

Every check (memory, time-series store, context broker, language model) should be `ok`. While the model is still downloading, the language model check is `degraded`.

**With the UI:** in `frontend/`, run `npm run dev`. The development server forwards `/api` and `/ws` to `XANA_BACKEND_URL` (default `http://localhost:8000`).

## API

Fields are snake_case. A refused request answers `{"error": {"kind", "message"}}`: `not_found` (404), `conflict` (409, the run's status does not allow the operation), `invalid` (422) or `unavailable` (503, for example when the memory database cannot be reached).

| Endpoint | Method | Purpose |
|---|---|---|
| `/api/auth/config` | GET | `{enabled, provider}`: whether sign-in is on |
| `/api/auth/connect` | POST `{username, password}` | Sign in; answers the session. `unauthorized` (401) for wrong credentials, `unavailable` if the provider can't be reached, `conflict` if sign-in is off |
| `/api/auth/status` | GET | `{valid, user, factory_id, company_id, token_expires_in_s}` |
| `/api/auth/logout` | POST | Sign out; 204 |
| `/api/agent/run` | POST `{machine_id, issue}` | Start a run; answers 202 `{run_id}` before the first step. `machine_id` may be a short name such as `laser-cutter-01` |
| `/api/agent/runs` | GET | Runs that are not archived, newest first |
| `/api/agent/status/{run_id}` | GET | The run with `data`, `steps`, `escalation`, `outbox` and `reopenable` |
| `/api/agent/clarify/{run_id}` | POST `{text, files}` | Answer the agent's question (`awaiting_input`); starts a new round |
| `/api/agent/confirm-resolution/{run_id}` | POST `{confirmed, text, files}` | Confirm (logs the incident) or reject with a reason (new round) in `awaiting_confirmation` |
| `/api/agent/stop/{run_id}` | POST `{reason?}` | Stop an open run, cancelling a round in progress |
| `/api/agent/archive/{run_id}` | POST | Move a finished run to the history; 204 |
| `/api/agent/escalate-preflight/{run_id}` | GET | Always `possible: false` in this phase |
| `/api/agent/reopen/{run_id}` | POST | Always `conflict` in this phase (no machine-builder conversations yet) |
| `/api/incidents` | GET `?machine_id&status=a,b&from&to` | History, newest first; `from` and `to` are inclusive dates (UTC) |
| `/api/incidents/{id}` | GET | A history record with decision, resolution and the full trace |
| `/api/incidents/{id}/reopen` | POST | Start a new run with the incident's machine and issue; 202 `{run_id}` |
| `/ws/run/{run_id}` | WebSocket | `snapshot` first, then `step` and `status` events; `keepalive` every 20 s while quiet; `error` and close code 4404 for an unknown or archived run |

- **Attachments:** `files` items are `{name, type, size, data_url}`: images, PDF or plain text, at most 5 files of 10 MB each. Only the name, type and size are kept.
- **Persistence:** every change is stored before the stream reports it. After a restart, open runs are listed again; a round that was in progress runs again from its start.
- **Concurrency:** at most `MAX_CONCURRENT_ROUNDS` rounds run at once; others wait in status `running`.

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

## Sign-in

Sign-in is on when `KEYCLOAK_URL` is set. The backend signs in on the operator's behalf, and keeps the token fresh in memory: it refreshes 60 seconds before expiry, retries every 12 seconds, and ends the session after 5 failed refreshes. Requests to the context broker carry the token when one exists.

To check sign-in in a browser, run `XANA_E2E_SIGNIN=1 XANA_E2E_BACKEND=1 npx playwright test signin` in `frontend/`, with the local environment started with the `auth` profile.

**Current limits, decided in `gh-21-keycloak-sign-in`:**

- One session per backend process: whoever signs in supplies the token for all platform calls, and signing out ends it for everyone.
- **The backend doesn't know who is calling, and its own API is not protected.** While anyone is signed in, anyone who can reach it can pass the sign-in screen, start runs that read platform data with the operator's token, read the operator's name and e-mail, and sign the operator out or replace the session. Limit network access to it, and use TLS, or the password crosses the network in plain HTTP.
- After a restart, or with nobody signed in, broker requests carry no token. A broker that requires one refuses them, and runs show the source as unavailable.

## Language model

- **Ollama:** the prompt size is limited by `LLM_NUM_CTX` (default 32768). Lower it if the server runs out of memory.
- **Failures:** a malformed answer is retried up to three times. If the model is unavailable, starting a run, clarifying, rejecting a resolution and reopening an incident answer `unavailable` (503) within `HEALTH_TIMEOUT_S`.
- **Health:** `/api/diagnostics` also lists `models`: `[{name, role, provider, available}]`.
- **Tracing (optional):** install with `pip install -e ".[tracing]"` and set `LANGFUSE_PUBLIC_KEY` and `LANGFUSE_SECRET_KEY`. Model calls are traced with the run ID as session, plus the machine and round. Without the keys or the package, nothing is traced and nothing changes.

## Deployment

The image in `Dockerfile` is the one used in production and by the local environment. It runs as a non-root user, and `/healthz` answers without checking dependencies. To install on Kubernetes, see [`helm/README.md`](../helm/README.md).

Database TLS: `POSTGRES_SSLMODE` and `POSTGRES_SSLROOTCERT` are added to both database URLs, unless a URL already states them.

## Tests and checks

```bash
cd backend
.venv/bin/ruff check . && .venv/bin/ruff format --check .
.venv/bin/pytest                   # agent package and service tests
```

- **Database tests:** tests marked `db` need PostgreSQL with TimescaleDB. Point `TEST_DATABASE_URL` at a server where the user may create databases, for example `TEST_DATABASE_URL=postgresql://xana@localhost:5432/postgres .venv/bin/pytest`. Without it they are skipped.
- **CI:** the `Backend` workflow runs linting, the formatting check, all tests including the database tests, and a check of `compose.yaml` on every pull request that touches `backend/`. Its `integration` job starts the local environment with `LLM_PROVIDER=scripted` and runs the UI's end-to-end tests on the backend data source (`frontend/e2e/backend/`); it also runs when the UI's data layer changes.

## Sample data

`sample_data/sample-data.json` is generated from the UI mock's seed, so the backend's machines are the ones the UI shows. Do not edit it by hand. After changing the seed, run `npx vite-node scripts/export-sample-data.mjs` in `frontend/`; a frontend test fails while the two differ.
