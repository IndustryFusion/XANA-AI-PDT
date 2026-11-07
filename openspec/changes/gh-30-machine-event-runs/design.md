# Design

## Conflicts

- **`architecture.md` describes the subscription as created on startup.** The issue says only when an identity is available, retried until it is. The issue is followed and `architecture.md` corrected.
- **`architecture.md` calls `/events/alert` a webhook for external alert systems, and the issue wants an alert from Alerta to start a run. Alerta 9 has no outbound webhook.** Its built-in plugins hold none, and neither does anything else on the platform today. So something has to be added on the Alerta side: see [Alerta's side](#alertas-side).

## What was verified on Scorpio before writing this

Against the broker image of the local environment:

- `receiverInfo` entries are sent as HTTP headers on HTTP notifications, so a shared secret works. A `PATCH` changes them and the address.
- A second `POST` of the same ID answers `409`. A `GET` by ID shows the subscription, including `receiverInfo`, and `notification.status`.
- **A write to a watched attribute notifies also if the value is the same.** A write to another attribute doesn't. Creating an entity with a watched attribute notifies too, and `notificationTrigger` doesn't change that on this broker.
- With `application/ld+json`, the body needs `@context`. Without one, `Machine` expands under the default context, so it matches nothing on data with full IRIs. So the subscription names `NGSI_CONTEXT_URL` when set, and the core context otherwise.
- **On data with full IRIs, `status` can't be named by a context.** Under a context mapping it to `https://…/status`, the broker keeps the core context's own term for it, while the other three and `Machine` expand as the context says, so a change of `status` notifies nothing. In full, it works. That is why `MACHINE_WATCH_TYPE` and `MACHINE_WATCH_ATTRIBUTES` exist, with the issue's values as defaults. Each takes a short name or a full IRI. Notifications are read by the last part of a name.

**Not verified: the real platform,** as none can be reached from here. If the platform's machines aren't of the configured type, or the attributes have other IRIs, nothing will match, and the subscription still reads as active. The platform's own type and attribute names decide the values to set.

## Decisions

### How webhook callers are authenticated

A shared secret, `EVENT_WEBHOOK_SECRET`, sent as `Authorization: Bearer <secret>` and compared in constant time, before anything of the body is read. Without one configured, every call is refused.

| Alternative | Why not |
|---|---|
| A Keycloak token from the caller | Scorpio can't get tokens. It sends a fixed header, nothing else |
| HMAC signature of the body | Scorpio can't sign |
| Secret in the callback's query | Ends up in access logs |
| Network policy only | Fails open on a shared network, and the acceptance criterion asks for refused calls |

**What this costs:** whoever may read subscriptions from the broker can read the secret, as with the MQTT token of `gh-23-live-updates`. Rotating it means a restart, which updates the subscription with `PATCH`. It travels in plain HTTP inside the cluster unless `CALLBACK_BASE_URL` uses TLS.

### The service identity

Issue #36 leaves this to here. A confidential Keycloak client with `client_credentials`: `KEYCLOAK_SERVICE_CLIENT_ID` and `KEYCLOAK_SERVICE_CLIENT_SECRET`. Its token stays in memory, renewed 60 seconds before it ends, retried every 12 seconds, with no limit on retries.

| Who | Token |
|---|---|
| The subscription | The service identity, or else the signed-in operator |
| A triggered run's reads, in every round, also after a restart | The same |
| A run an operator started | The session, as today |
| Explorer, alerts and everything else under `/api` | The session, as today |

Alternatives: **the session only**, which leaves nothing running when nobody is signed in, which is what this issue is for. **A stored operator's refresh token**, which ties machine events to one person, and ends when that person leaves or changes a password. **The dataspace token**, which is another realm.

The service identity is deliberately never used for what a caller of `/api` asks, as nothing there says who is calling until #36: `POST /api/agent/run` with nobody signed in still has no token. **One gap stays until #36:** anyone who can reach `/api` can answer a triggered run's question, which starts a new round with the service identity, and read its steps. That reads one machine's data, on a network that `helm/README.md` already says has to be restricted. #36 has to close it.

With sign-in off, no token is needed, so the identity counts as available.

### Which events start a run

A run starts for an event if the machine has no open run, and:

- **from the broker:** the machine's watched values differ from those last seen. They are stored, so that a restart doesn't start a run for every machine at its next write. **A machine never seen counts as changed, so its first report starts one run,** also a healthy one: a machine created with `status: running`, or each machine once after the first install, since the first report of a real fault can't be told from it. Nothing says what a healthy value is on the platform.
- **from Alerta:** the alert isn't a repeat (`repeat`), its severity isn't `ok`, `normal`, `up`, `cleared`, `informational`, `debug` or `trace`, and its status isn't `closed`, `expired`, `shelved` or `blackout`. `resource` is the machine, as on the Alerts screen. `{machine_id, issue}` is accepted too, for other senders.

Values seen during an open run are stored too. So a fault that came during a run and is reported again after it ends starts nothing new, while a further change does.

Alternative: no comparison, as the issue doesn't ask for it. A platform that writes `status` regularly would then start a new run after every run ended, for every machine, forever.

### One open run per machine

Checked by the worker, one event at a time, on the same state as the screens: any status that isn't final, so paused runs count, and a reopened run counts again. Since it reads stored state, this holds after a restart. A run an operator is starting at that moment counts.

**An operator can still start a second run on a machine with an open run**, as today, because refusing would change existing behaviour that no issue asks to change.

### What can fail

| Failure | What happens |
|---|---|
| Queue full | `503`, so the sender can tell. The queue holds 1000 events |
| Memory database down | The worker holds the event and tries again every 5 s, so nothing is lost while the process lives. The queue fills behind it |
| Language model down | The run starts, and fails visibly with its source. Unlike an operator, nobody is there to read a refusal |
| Unknown short name | Logged and dropped |
| Anything unexpected | Logged and dropped; the worker goes on |
| Backend stops | **What is in the queue is lost.** The issue asks for a queue, and the broker doesn't retry. Keeping events in the database would add a store for a window of milliseconds |

### The subscription's life

A loop every 15 s. No identity: `waiting_for_identity`, and it tries again. Otherwise `POST`; a `409` becomes a `PATCH`, so a restart creates no duplicate and takes up a new address or secret. After that it reads the subscription every 60 s: gone means create it again, `notification.status` of `failed` shows as a degraded check.

Unlike the live updates subscription, this one has no expiry and isn't deleted at shutdown: events should go on being sent, and the next start finds it.

| State | Check |
|---|---|
| `not_configured` (no `CALLBACK_BASE_URL`) | `ok`, and left out of the overall result, as for the dataspace |
| `waiting_for_identity` | `degraded` |
| `active` | `ok` |
| `delivery_failing` | `degraded` |
| `failed` | `error` |

### Alerta's side

A small plugin in `backend/alerta/xana_events/`, loaded by Alerta's plugin mechanism. It sends each received alert to `XANA_EVENTS_URL` with the secret, with a 3 second limit, and never fails the alert: a stopped backend doesn't affect Alerta. The local environment loads it with `--profile alerts`.

**What the platform lacks:** its Alerta chart installs plugins from one fixed repository by name, and has `PLUGINS = ['blackout']`. Using this plugin there needs an image or a chart change on the platform, which this change doesn't make.

Alternative: the backend polls Alerta, which needs nothing on the platform. It isn't what the issue describes (`POST /events/alert`), and it would need its own record of what it has seen. A maintainer may prefer it.

### A run's source

`operator`, `ngsi` or `alert`, stored with the run and the incident, and shown in lists and the run view. A reopened incident is an operator's act, so it is `operator`. Existing rows read as `operator`.

## Architectural implications

- A second way in, and the first that doesn't start with an operator: `architecture.md`'s Event Layer describes it, and is corrected for the identity and the comparison.
- New secrets, added to redaction. No new runtime dependency in the backend.

## Alternatives for the queue

An external queue such as Kafka is on the platform, but the issue asks for a queue and a worker in the backend, and the backend is one process by design (`helm/charts/xana-pdt`: one replica).
