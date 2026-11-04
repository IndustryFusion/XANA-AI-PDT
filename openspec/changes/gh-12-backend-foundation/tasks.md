# Tasks

## 1. Project setup

- [x] 1.1 Create `backend/` and `backend/agent/` with the layout and `pyproject.toml` files from design decisions 1–3; verify that `pip install -e backend/agent -e "backend[dev]"` succeeds on Python 3.12 and that `python -c "import app, xana_agent"` works
- [x] 1.2 Add the Ruff configuration and pytest setup (including the `db` marker skipped without `TEST_DATABASE_URL`); verify that `ruff check`, `ruff format --check` and `pytest` run, with an initial smoke test in each package
- [ ] 1.3 Add the `Backend` CI workflow from design decision 11; verify that it passes on this pull request and is not triggered by frontend-only changes

## 2. Service runtime

- [x] 2.1 Implement the settings with defaults, validation and secret typing, and `backend/.env.example`; verify tests for default start, invalid threshold and invalid provider, a missing cloud API key, and a test asserting that every settings field appears in `.env.example` (spec: service-runtime → Configuration from the environment, Language model selection → Missing key)
- [x] 2.2 Implement URL masking and make sure secrets never appear in responses, logs or errors; verify tests that capture logs and responses for a failing dependency whose URL contains a password, and the configuration error for a secret variable (spec: service-runtime → Secrets stay secret)
- [x] 2.3 Implement `get_llm()` for `ollama`, `anthropic`, `openai` and `scripted`; verify tests for the provider chosen per configuration, and that the scripted model returns schema-valid structured answers without network access, using a network-blocking fixture (spec: service-runtime → Language model selection)
- [x] 2.4 Implement the application factory and startup that tolerates unreachable dependencies; verify a test that starts the app with all dependency URLs pointing to closed ports and gets a health report (spec: service-runtime → Starts without its dependencies)
- [x] 2.5 Implement the four health checks with timeout, concurrency, caching and the overall rule, and `GET /api/diagnostics`; verify tests with stubbed dependencies for all ok, one down, slow, and cached versus fresh (spec: service-runtime → Dependency health)

## 3. Incident memory

- [x] 3.1 Implement the migration runner with the tracking table, a transaction per file and the advisory lock, plus `001_schema_migrations.sql`; verify `db` tests for empty database, restart, new migration and failing migration (spec: incident-memory → Managed memory schema)
- [x] 3.2 Retry pending migrations from the memory health check; verify a `db` test that starts with the database unreachable, makes it reachable, and checks that migrations are applied and memory reports `ok` (spec: incident-memory → Memory reachable later)

## 4. Local environment

- [x] 4.1 Add the frontend seed export script and `backend/sample_data/entities.json`, plus the frontend drift test; verify that the drift test passes and fails after a deliberate seed change (spec: local-environment → Sample machine data)
- [x] 4.2 Implement the sample-data loader (entity upsert and 24 h attribute history ending at load time, loaded once); verify `db` tests for history range and idempotence, and a test against a stubbed broker for entity upsert (spec: local-environment → Sample machine data)
- [x] 4.3 Add `backend/compose.yaml`, the database init script, `backend/Dockerfile` and the `no-model` profile; verify manually that a first start reports all `ok`, that the `no-model` start skips the model download, and that data survives a stop and start; record the result in the pull request (spec: local-environment → One-command local environment)
- [x] 4.4 Add the development server proxy for `/api` and `/ws` with `XANA_BACKEND_URL`; verify manually that `/api/diagnostics` is reachable through the frontend address, with the default and with a changed backend address (spec: local-environment → Frontend connects in development)

## 5. Documentation

- [x] 5.1 Write `backend/README.md` (local environment, configuration, tests); verify that every command in it was run
- [x] 5.2 Update `architecture.md` → Backend (package layout, what exists), Configuration (the variables) and Data Layer (time-series layout); verify that the sections match design decisions 1, 4 and 6
- [x] 5.3 Run `openspec validate gh-12-backend-foundation --strict`; verify that it passes
