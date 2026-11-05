# Proposal

Issue: #12

## Why

The operator UI runs only on its mock data source; there is no backend. Issue #12 delivers phase 1 of the backend in four changes. This first change lays the base the others build on: a backend service that starts from environment configuration, reports the health of every dependency, owns the incident memory database, and runs completely on a developer machine with sample machine data and a local language model.

## What Changes

- Add a Python 3.12 FastAPI service in `backend/` that reads its configuration from environment variables, refuses to start with a clear message when the configuration is invalid, and never exposes secrets.
- One place that creates the language model from configuration. Local Ollama is the default; Anthropic and OpenAI can be selected. A `scripted` provider gives fixed answers, so tests, CI and demos run without a model.
- Diagnostics: a health endpoint that checks the memory database, the time-series store, the NGSI-LD context broker and the language model, each with status, latency and detail. It answers even when every dependency is down.
- Incident memory in PostgreSQL. Schema migrations are tracked and applied automatically at startup and are safe to apply again. The schema for runs and incidents is created by the changes that use it.
- Local environment: one command starts the backend, PostgreSQL with TimescaleDB, an NGSI-LD context broker and Ollama, and loads sample machine data (machines, components, relationships and signal history). The frontend development server forwards `/api` and `/ws` to the backend.
- Backend conventions: project layout, linting, tests and a `Backend` CI workflow for pull requests that touch `backend/`.
- `architecture.md` → Backend and Configuration are updated to describe what exists.

## Capabilities

### New Capabilities

- `backend/service-runtime`: Configuration, secret handling, language model selection and dependency health reporting.
- `backend/incident-memory`: The memory database and its schema migrations.
- `backend/local-environment`: Running the backend and its dependencies on a developer machine with sample data, connected to the frontend development server.

### Modified Capabilities

None.

## Impact

- New code: `backend/` (service, migrations, sample data, local environment, tests). New `Backend` CI workflow.
- New runtime dependencies for the backend only, as listed in `design.md`. No frontend change, except the development server proxy setting.
- `architecture.md` sections affected:
  - **Backend**: describes the service as built. The API Layer table keeps its target content, and only the diagnostics endpoint exists after this change.
  - **Configuration**: the variables this change reads.
  - **Data Layer**: the time-series table layout (see `design.md`, decision 6).
- **Deployment Architecture** is not changed.

## Out of Scope

- The agent workflow (change `gh-12-agent-workflow`).
- Run operations, the run stream and incident records (change `gh-12-run-api`).
- The frontend backend data source (change `gh-12-ui-backend-source`).
- Escalation, dataspace, event triggers, data explorer and alerts backends, and sign-in: later phases of the backend.
- Container images for deployment, Helm charts and Kubernetes. The local environment builds the backend image only for local use.
