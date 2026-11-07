# XANA AI PDT — Backend

Python 3.12 / FastAPI backend of XANA AI PDT. It is built in phases (issue #12). Today it provides:
- the service runtime: configuration, language model selection, and a health report of every dependency;
- sign-in through Keycloak, and the operator's token for the context broker ([Sign-in](#sign-in));
- the incident memory database and its migrations;
- the Data Explorer's routes on the context broker and the attribute history ([Data Explorer](#data-explorer));
- runs that operators start, clarify, confirm or reject, stop and archive, with a live stream and the incident history ([API](#api));
- runs that start from machine events and alerts ([Machine events](#machine-events));
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

## Machine events

A problem on a machine starts a run by itself. `POST /events/ngsi` and `POST /events/alert` add to a queue of 1000, with one worker. Such a run appears and behaves like any other, with `source` `ngsi` or `alert`.

- **Who may call:** whoever presents `EVENT_WEBHOOK_SECRET` as `Authorization: Bearer <secret>`. Without one set, every call is refused. Whoever may read subscriptions from the broker can read the secret.
- **The subscription:** with `CALLBACK_BASE_URL`, the backend as the broker reaches it, it keeps `urn:ngsi-ld:Subscription:XanaPDT:MachineWatch`. It needs an identity when sign-in is on, tries again until it has one, and updates what exists after a restart. It isn't deleted on shutdown. The `machine_events` check in the health report gives its state.
- **Platform data:** `MACHINE_WATCH_TYPE` and `MACHINE_WATCH_ATTRIBUTES` say what it watches, as short names under `NGSI_CONTEXT_URL` or as full IRIs. **`status` is a term of NGSI-LD's core context, and the broker keeps that meaning under any context, so on data with full IRIs, name it in full.** A wrong type or attribute matches nothing, and the check still says `ok`. This hasn't been tried on the real platform. **In a tenant, expect nothing to be delivered:** with `NGSI_TENANT` the broker reads a subscription's context from its default tenant only, and drops every notification unless the same context is subscribed there too, so the check is `degraded`.
- **The identity:** `KEYCLOAK_SERVICE_CLIENT_ID` and `KEYCLOAK_SERVICE_CLIENT_SECRET` name a client with a service account, which needs read access to the broker. Without one, the signed-in operator's token is used. Triggered runs and the subscription use this, also after a restart. Runs that operators start and routes under `/api` never do.
- **What starts a run:** every event, unless a run that an event started for that machine is still in its first analysis, until it completes, fails, is stopped or pauses for the operator. Paused runs and runs an operator started hold nothing up. From the broker: each entity with an ID, with no comparison against values reported before, as the broker notifies every write. From an alert: one that isn't a repeat, not `ok`, `normal`, `up`, `cleared`, `informational`, `debug` or `trace`, and not `closed`, `expired`, `shelved` or `blackout`. An operator can still start a second run on a machine.
- **When things fail:** a full queue answers 503. While the memory database is down, the event waits. Data it refuses for what it is, or its size, is dropped and logged, and anything else is tried again. A body over 10 MiB answers 413. After a triggered run failed, a machine's events start nothing for 5 minutes: the latest per source is held in memory, and starts when that ends. With the language model down, the run starts and fails visibly. An unknown short name is logged and dropped. **What is in the queue when the backend stops is lost.**
- **Alerta:** it has no outbound webhook, so `alerta/plugin/` sends its alerts, with `XANA_EVENTS_URL` and `EVENT_WEBHOOK_SECRET` set in Alerta's environment. It is loaded by adding the folder to `PYTHONPATH` and `xana_events` to `PLUGINS`, as the local environment does. **The platform's Alerta doesn't load it,** as its chart installs plugins from one fixed repository by name, so it needs an image or chart change there.
- **While the API is open:** anyone who can reach `/api` can answer a triggered run's question, which starts a new round with the service identity, and read its steps. See [Sign-in](#sign-in).

## Dataspace

With `GATEWAY_URL`, the backend is a participant of the IndustryFusion Dataspace. Its contract is `gateway-api.md` in that repository. `GATEWAY_KEYCLOAK_URL` has to be the address the dataspace's services know Keycloak by, as they compare a token's issuer exactly, and `SETTINGS_ENCRYPTION_KEY` is required. The client ID is an operator's `ifric_company_id` claim, or else `GATEWAY_CLIENT_ID`.

The client secret is entered on the Dataspace screen or set in `GATEWAY_CLIENT_SECRET`. Once accepted, it is stored encrypted in `gateway_credentials`. If the key changes, the stored secret can't be read, and the screen asks for it again. The token stays in memory. It is checked every 60 seconds and renewed with 120 seconds left, and after 3 failures in a row renewal stops and the screen says so. The backend connects by itself at startup, with sign-in on or off, and after sign-in when it isn't connected, unless the operator disconnected. With sign-in on and nobody signed in, the client is `GATEWAY_CLIENT_ID`; a connection that is made stays when an operator of another company signs in, and the status names the client in use. If the dataspace can't be reached, it tries again every 60 seconds until it connects; a rejected credential is not tried again. The `dataspace_connector` health check says why it isn't connected.

The health report's `dataspace_connector` check reads through the participant's adapter, as the contract offers agents nothing that reaches the connector. A connector failing behind a working adapter doesn't show there.

## Escalation

`POST /api/agent/escalate/{id}` sends an incident to the machine's builder, from `awaiting_input` or `awaiting_confirmation`, and `GET /api/agent/escalate-preflight/{id}` says first whether that is possible, and why not. `DATA_SHARING_POLICY` decides what may go: `minimal` the machine's entity and alerts, `adjacent` also entities one relationship away, `timeseries` also 24 hours of signal history, of related entities only if those may go too. The dataspace doesn't enforce this, so the backend filters. A capability also needs access `auto` or `approved` for that builder, so `adjacent` sends only the machine's data until `twin:adjacents` is approved on the Dataspace screen. A `policy_check` step shows what was sent and withheld.

A failed send leaves the run's status as it was. Trying again doesn't send the files again, except if the backend stopped just after the gateway accepted them, as the contract has no idempotency key.

## Conversation with the machine builder

`INBOX_POLL_INTERVAL_S` (default 15) sets how often the inbox is read. A message is stored, with its step and ID in one transaction, before it is acknowledged, and a message for no run stays unacknowledged. Only an operator's request sends anything. The incident agent reads and answers, and what it drafts is a suggestion. It has no way to reach the dataspace.

Evaluation cases for tool selection and behaviour need no dataspace: `python -m xana_agent.conversation.evaluate` runs them by rules, as the tests do, and `python -m app.evaluate` with the configured model.

## IFRIC registry

With `IFRIC_URL`, including its port (the registry's default is 4007), company names, machine builders and factory details come from the IFRIC registry, asked with the dataspace token. The registry and dataspace must share a realm, and a participant's ID must equal its company's `company_ifric_id`, or the registry refuses it. `FACTORY_ID` names the factory when the operator's token has no `ifric_factory_id`.

A machine's builder is asked for with the machine's entity ID, so it has to be the registry's `asset_ifric_id`; if not, the machine has no known builder, and escalation says so. Machine names come from the context broker, as registry assets have none.

A failed name lookup gives an empty name, and a screen shows the identifier. In the health report, `401` and `403` count as failures.

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

**With the explorer's history and time-shift:** add `--profile history`, which starts PostgREST (v12, as on the platform) on the sample history. An existing database gains the platform's columns when the sample data loads. To refuse requests without a token, as the platform does, set `XANA_PGREST_ANON_ROLE=` and use the `auth` profile too, with `KEYCLOAK_URL=http://keycloak:8080`.

**With live updates:** add `--profile live`, which starts EMQX (5.8, as on the platform). Here it takes any client; the platform checks a token and a role. See [Data Explorer](#data-explorer). `--profile platform-mqtt` starts another EMQX that checks like the platform, for tests: it needs the `auth` profile, and `emqx/mqtt_auth.py` has the rules.

**With value hints:** add `--profile ontology`, which starts Fuseki and loads sample shapes and knowledge from `sample_data/ontology/`.

**With a dataspace:** run one by its own instructions, and set `GATEWAY_URL`, `GATEWAY_KEYCLOAK_URL`, `GATEWAY_CLIENT_ID` and `SETTINGS_ENCRYPTION_KEY`.

**With the IFRIC registry:** add `--profile ifric`, which starts a stub of the routes the backend uses, with `IFRIC_URL=http://ifric:4007` and `FACTORY_ID=urn:ngsi-ld:Factory:plant-north`. To use the real one, run it from its own repository, on the dataspace's realm.

**With machine events:** set `EVENT_WEBHOOK_SECRET` to any value, `CALLBACK_BASE_URL=http://backend:8000`, and for alerts `XANA_EVENTS_URL=http://backend:8000/events/alert`. With sign-in, the realm has a client for it: `KEYCLOAK_SERVICE_CLIENT_ID=xana-events`, `KEYCLOAK_SERVICE_CLIENT_SECRET=local-development-only-secret`.

**With alerts:** add `--profile alerts`, which starts Alerta (9.0.4, as on the platform, with its severities) and sends sample alerts in the form the platform's rules give them. The key is `local-development-only-key` unless `ALERTA_API_KEY` is set. Without the profile, the Alerts screen says that Alerta is unavailable, and runs show that source as unavailable.

**Ports in use:** if a host port is taken, set `XANA_DB_PORT`, `XANA_BROKER_PORT`, `XANA_OLLAMA_PORT`, `XANA_KEYCLOAK_PORT`, `XANA_PGREST_PORT`, `XANA_MQTT_PORT`, `XANA_MQTT_MGMT_PORT`, `XANA_MQTT_PLATFORM_PORT`, `XANA_FUSEKI_PORT`, `XANA_ALERTA_PORT` or `XANA_BACKEND_PORT`.

The local environment is for development only. The database trusts local connections, and every port is bound to `127.0.0.1`.

Check it:

```bash
curl 'http://localhost:8000/api/diagnostics?fresh=true'
```

The memory, time-series store, context broker and language model checks should be `ok`. A service with a default address that isn't running, such as Alerta without its profile, shows as `error`, and overall as `degraded`: a report can't tell one not installed from one that stopped. Each check has its `probe` address and a `hint`. A `401` or `403` is a failure, and an empty ontology dataset `degraded`. While the model is still downloading, the language model check is `degraded`.

**With the UI:** in `frontend/`, run `npm run dev`. The development server forwards `/api` and `/ws` to `XANA_BACKEND_URL` (default `http://localhost:8000`).

## API

Fields are snake_case. A refused request answers `{"error": {"kind", "message"}}`: `not_found` (404), `conflict` (409, the run's status does not allow the operation), `invalid` (422), `unauthorized` (401) or `unavailable` (503 when the memory database cannot be reached, 502 for a service behind the backend such as the context broker or PostgREST).

| Endpoint | Method | Purpose |
|---|---|---|
| `/api/diagnostics` | GET `?fresh=true` | The health of every connection: `{overall, checked_at, checks: [{id, label, status, latency_ms, detail, probe, hint}], models}` |
| `/api/config` | GET | Service addresses, read-only, with passwords masked: `[{key, label, value, deployment_value, changed, editable}]`. They are set at deployment, and no route takes an address from a browser |
| `/api/auth/config` | GET | `{enabled, provider}`: whether sign-in is on |
| `/api/auth/connect` | POST `{username, password}` | Sign in; answers the session. `unauthorized` (401) for wrong credentials, `unavailable` if the provider can't be reached, `conflict` if sign-in is off |
| `/api/auth/status` | GET | `{valid, user, factory_id, company_id, token_expires_in_s}` |
| `/api/auth/logout` | POST | Sign out; 204 |
| `/api/agent/run` | POST `{machine_id, issue}` | Start a run; answers 202 `{run_id}` before the first step. `machine_id` may be a short name such as `laser-cutter-01` |
| `/api/agent/runs` | GET | Runs that are not archived, newest first. Each has `source`: `operator`, `ngsi` or `alert` |
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
| `/api/ngsi/types`, `attributes`, `stats` | GET | The broker's types and attributes, and the count per type |
| `/api/ngsi/entities` | GET `?type&id&id_pattern&q&limit` | Query. `limit` is 1 to 1000, default 100 |
| `/api/ngsi/entities/{id}` | GET, DELETE | One entity |
| `/api/ngsi/entities/{id}/attrs` | PATCH, POST, DELETE `?name&sub_attribute` | Merge into attributes, add attributes, delete an attribute or sub-attribute; 204 |
| `/api/ngsi/import` | POST `[entity]` | Create or merge; one `{id, result, reason}` per entry. 207 if any failed |
| `/api/ngsi/import/fetch` | POST `{url}` | A document from a public address; `{url, document}` |
| `/api/ngsi/delete-by-types` | POST `{types}` | `[{type, count}]` |
| `/api/ngsi/history` | GET `?entity_id&attribute&from&to&dataset_id` | `[{at, value}]`, oldest first, the newest 5000 |
| `/api/ngsi/attr-status` | GET `?entity_id` | The latest recorded state per attribute: `{name: {deleted, observedAt}}` |
| `/api/ngsi/timeshift/types` | GET `?at` | Types at a past moment |
| `/api/ngsi/timeshift/entities` | GET `?at&type&id&id_pattern&q&limit` | Entities as they were at a past moment |
| `/api/ngsi/ws` | WebSocket `?type&ids=a,b` | Changes as they happen: `{type: "update", entity_id, entity_type, attributes}`, with the whole entity's attributes as the broker notifies them, and `keepalive` every 20 s while quiet. A client that falls behind is closed with code 1013, and one that stops reading is reset after 10 s. A page from another origin is refused, unless `WS_ALLOWED_ORIGINS` lists it |
| `/api/shacl/hints` | GET `?entity_type&attribute` | `{hint_type, values, minimum, maximum, minimum_exclusive, maximum_exclusive, datatype, detail}`. Always answers: `none` with a reason when Fuseki can't |
| `/api/alerta/alerts` | GET `?status=a,b&severity&environment&service&text&sort&page&page_size` | `{alerts, total, bySeverity, page, pageSize}`. Default: open and acknowledged, most severe and newest first |
| `/api/alerta/alerts/count` | GET `?status=a,b` | `{total, bySeverity}` |
| `/api/alerta/alert/{id}` | GET | An alert with its `history` |
| `/api/alerta/alert/{id}/action` | PUT `{action, text}` | `ack`, `unack`, `shelve`, `unshelve`, `close` or `open`; answers the updated alert |
| `/api/alerta/environments`, `services` | GET | Names |
| `/api/alerta/config` | GET | `{refresh_interval_s}` |
| `/api/ngsi/subscription-health` | GET | `{status, state, detail, expires_at, delivery}` of live updates |
| `/events/ngsi` | POST | A notification of the context broker. Needs the webhook secret. 202 `{accepted, ignored}`; `unauthorized`, `invalid`, or 503 with the queue full |
| `/events/alert` | POST | An Alerta alert or `{machine_id, issue}`. As above |
| `/ws/run/{run_id}` | WebSocket | `snapshot` first, then `step` and `status` events; `keepalive` every 20 s while quiet; `error` and close code 4404 for an unknown or archived run |

- **Attachments:** `files` items are `{name, type, size, data_url}`: images, PDF or plain text, at most 5 files of 10 MB each. Only the name, type and size are kept.
- **Persistence:** every change is stored before the stream reports it. After a restart, open runs are listed again; a round that was in progress runs again from its start.
- **Archiving:** always an operator's act: a finished run stays listed until then, also after a restart.
- **Concurrency:** at most `MAX_CONCURRENT_ROUNDS` rounds run at once; others wait in status `running`.
- **Automatic archive:** a finished run (`completed`, `failed`, `stopped`, `mb_closed`) with no change for `AUTO_ARCHIVE_AFTER_S` seconds (3600 by default) is archived as an operator archive would, checked every minute. A run whose close hasn't reached the machine builder, or one waiting for anyone, stays. `0` turns it off. The time counts from the run's last stored change, so a restart doesn't reset it.

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

## Data Explorer

Routes under `/api/ngsi` reach only `NGSI_URL` and `PGREST_URL`, with the session's token. No route takes an address. They are for operators: the diagnostic workflow has no path to them, and only reads.

- **Names on platform data:** attributes are full IRIs, and answers keep them. A short name in `q` silently matches nothing unless `NGSI_CONTEXT_URL` names a context that maps it. The same goes for the agent's lookups through `partOf` and `measures`. What the broker can't evaluate in `q` (`~=`, `!~=`, `!attr`, ranges and IRIs with a dot) is evaluated by the backend over up to 5000 entities, and the header `X-Results-Limited: scanned=5000, total=5300` says when there were more. Patterns run on RE2, so look-around and back-references are refused.
- **Contexts:** an imported entity may name only the ETSI core context, `NGSI_CONTEXT_URL`, or what `NGSI_ALLOWED_CONTEXTS` lists, because the broker fetches a context from inside the platform.
- **Concurrent edits:** one read-then-write at a time per entity, so two adds of one attribute give one `conflict`. Another writer can still change an attribute in between.
- **History:** PostgREST needs `TIMESCALE_TABLE` and `TIMESCALE_ENTITY_TABLE` in the platform's layout. On the platform, the operator's token must carry the `role` claim, which the `scorpio` client's `pgrest_role` scope adds.
- **Import from a URL:** refuses every internal address, also after a redirect, and connects only to the address it checked. 10 MB and 10 s at most.
- **Live updates:** one subscription of 24 hours in the context broker, with an MQTT endpoint on `MQTT_BROKER_NOTIFY_URL`, starting after sign-in. It is renewed when the token rotates and an hour before it expires, and deleted on sign-out and shutdown. If the process dies, it runs out by itself, and the next start removes it.
  - **On the platform,** each operator needs `Factory-Admin` or `Factory-Reader` on client `scorpio`, or EMQX refuses the token and the state says so.
  - **What `ok` means:** connected and subscribed. Scorpio reports nothing about failed MQTT deliveries, so `delivery` says whether a change has arrived yet, and a change made here that doesn't arrive in 15 s gives `delivery_failed`.
  - **The token is in the subscription's address,** as the broker has no other way to take MQTT credentials. It isn't logged or returned here, but anyone who may read subscriptions from the broker can read it until it expires.
- **While the session is shared:** anyone who can reach the backend can edit, delete and import, using the signed-in operator's token. See [Sign-in](#sign-in).

## Alerts

Routes under `/api/alerta` reach only `ALERTA_URL`, with `ALERTA_API_KEY`. A URL that doesn't end in `/api` stops the backend with a message that says so. A stopped Alerta, or one that refuses the key, gives 502.

- **Search:** the text is matched by the backend, over up to 1000 alerts of the other filters, as Alerta's own query language fails on text like an entity ID. `searchLimited` says when there were more.
- **In a run:** the observe step reads open and acknowledged alerts of the machine and up to 5 related entities, by their full IDs, which is what the platform's rules set as `resource`. They are weighted by severity and age, with the weight halving every 24 hours, and at most 20 go to the hypothesize step. If a read fails, the run continues with the others, and shows the source as unavailable.
- **Actions are for operators.** The workflow's source sends only GET requests. All actions use the configured key, so Alerta can't tell operators apart.

## Ontology

The machine ontology and SHACL shapes are read from Fuseki (`FUSEKI_URL`, `FUSEKI_DATASET`). This is a formal model, not document retrieval, and is not part of the RAG exclusion.

- **Graph names** start with `FUSEKI_GRAPH_BASE`: `<base>/shacl.ttl` and `<base>/knowledge.ttl`. On the platform that is `http://<Fuseki's external host>/<realm>`, which differs from the service's address, so it must be set.
- **Tokens:** the operator's token is sent. Through the platform's ingress, operators need `Factory-Admin` or `Factory-Reader` on client `fuseki`; the service `fuseki:3030` itself doesn't check.
- **For the agent (#29):** `xana_agent.sources.FusekiOntologySource` has `query`, `shapes` and `knowledge`, which only read and give errors as data. `query` first refuses the word `service` anywhere in the text, in any case (Fuseki would call any address in a query, and this parser and Fuseki's don't read every text alike), any `\u` or `&#`, and more than 4000 characters. A query that merely holds the word is refused too. Then it refuses updates and what can't be parsed.
- **Query input:** entity types and attributes go into queries only escaped. Tests parse the resulting queries, and try hostile input against a real Fuseki (`TEST_FUSEKI_URL`).

## Language model

- **Ollama:** the prompt size is limited by `LLM_NUM_CTX` (default 32768). Lower it if the server runs out of memory.
- **Failures:** a malformed answer is retried up to three times. If the model is unavailable, starting a run, clarifying, rejecting a resolution and reopening an incident answer `unavailable` (503) within `HEALTH_TIMEOUT_S`.
- **Health:** `/api/diagnostics` also lists `models`: `[{name, role, provider, available}]`.
- **Tracing (optional):** install with `pip install -e ".[tracing]"` and set `LANGFUSE_PUBLIC_KEY` and `LANGFUSE_SECRET_KEY`. Traces go to `LANGFUSE_HOST`, or `LANGFUSE_BASE_URL`, its newer name, such as your own Langfuse server; without either, to Langfuse's default. Two different addresses stop the backend at startup. Model calls are traced with the run ID as session, plus the machine and round. Without the keys or the package, nothing is traced and nothing changes.

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
- **Real services:** `tests/test_explorer_real.py` runs against a real broker and PostgREST, with `TEST_BROKER_URL`, `TEST_PGREST_URL` and `TEST_TSDB_URL`. Without them it is skipped. It writes rows in the platform's table layout.
- **Real Fuseki:** `tests/test_ontology_real.py` needs `TEST_FUSEKI_URL`; `tests/test_live_updates_real.py` needs `TEST_MQTT_URL` too.
- **Real MQTT:** `tests/test_live_updates_real.py` needs `TEST_BROKER_URL`, `TEST_MQTT_URL` and `TEST_MQTT_NOTIFY_URL`, and for tokens, roles and rotation `TEST_MQTT_PLATFORM_URL`, `TEST_MQTT_PLATFORM_NOTIFY_URL` and `TEST_KEYCLOAK_URL`. `TEST_MQTT_CONTAINER` and `TEST_MQTT_PLATFORM_CONTAINER` name the containers it restarts. Without them those tests are skipped.
- **CI:** the `Backend` workflow runs linting, the formatting check, all tests including the database tests, and a check of `compose.yaml` on every pull request that touches `backend/`. Its `integration` job starts the local environment with `LLM_PROVIDER=scripted` and runs the UI's end-to-end tests on the backend data source (`frontend/e2e/backend/`); it also runs when the UI's data layer changes.

## Sample data

`sample_data/sample-data.json` is generated from the UI mock's seed, so the backend's machines are the ones the UI shows. Do not edit it by hand. After changing the seed, run `npx vite-node scripts/export-sample-data.mjs` in `frontend/`; a frontend test fails while the two differ.
