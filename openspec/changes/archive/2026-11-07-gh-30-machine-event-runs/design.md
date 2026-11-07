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

**A subscription in a tenant delivers nothing.** The broker stores a subscription's context as `urn:<hash>`, and reads it again at notification time from the default tenant's `contexts` table only. For a subscription in another tenant that is a 404, and the notification is dropped (`LdContextNotAvailable`), while the subscription reads `timesSent: 0` and status `ok`. Reproduced on a fresh broker: 0 of 3 changes delivered in a tenant, and all 3 once a subscription with the same context existed in the default tenant, as that leaves the row there. That makes it easy to miss, and depends on what else was subscribed. So with `NGSI_TENANT`, the subscription is still made, and the `machine_events` check is `degraded` and says that no event will arrive. The backend still starts. The default tenant with `NGSI_CONTEXT_URL` works, on a fresh subscription and after a `PATCH`.

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

### Which events start a run: decided by a maintainer

The maintainer decided that this follows the behaviour of the earlier system. Every event starts a run, unless a run that an event started for the same machine is in progress:

- **from the broker:** each entity of a notification that has an ID. The issue names the watched values it holds, or says `state change detected` when it holds none. Values are not compared with those reported before, and nothing about them is stored.
- **from Alerta:** the alert isn't a repeat (`repeat`), its severity isn't `ok`, `normal`, `up`, `cleared`, `informational`, `debug` or `trace`, and its status isn't `closed`, `expired`, `shelved` or `blackout`. `resource` is the machine, as on the Alerts screen. `{machine_id, issue}` is accepted too, for other senders, and each such call starts a run.

**In progress** means from the run's start until its first analysis ends: it completes, fails, is stopped, or pauses for the operator (`awaiting_input`, `awaiting_confirmation`). A paused run holds nothing up, nor does its next round after the operator answers, nor acting on a confirmation, nor a conversation with the machine builder. Runs an operator started don't count, and an operator can still start a run on any machine. The worker checks this one event at a time, so events arriving together during a run start one run. After a restart, a triggered run whose first analysis runs again counts as in progress; a paused one doesn't.

Alternatives that were considered:

- **Compare with the values last seen, stored per machine, with a machine's first report counting as a change,** and count any open run, also a paused one, an operator's and one after a restart, which the first version did. It keeps a platform that writes `status` regularly from starting a new run after every run ended.
- **Count any open run, without comparing values.**

What this costs: a platform that writes a watched attribute regularly, changed or not, starts a run at each write that arrives while no triggered run of that machine is in its first analysis. Paused runs can pile up for one machine.

### What can fail

| Failure | What happens |
|---|---|
| Queue full | `503`, so the sender can tell. The queue holds 1000 events |
| Memory database down | The worker holds the event and tries again every 5 s, so nothing is lost while the process lives. The queue fills behind it |
| Language model down | The run starts, and fails visibly with its source. Unlike an operator, nobody is there to read a refusal |
| A triggered run just failed | For 5 minutes, an event for that machine starts nothing, so that a failing model gives one failed run per machine, not one per alert. The latest event per machine and source is held in memory, and starts when the wait ends. The earlier behaviour had no such wait; it is kept as a protection a maintainer may drop |
| Unknown short name | Logged and dropped |
| Short name with the broker down | It stays as given, and a run in progress whose identifier ends in it counts as that machine's |
| Data the database refuses | NUL and lone surrogates are taken out first, and nothing left is refused. Only a data, integrity or limit error (class 54) is logged and dropped. Everything else is tried again, as a read-only database or a missing right can be put right, so such a fault holds the queue back until then. A body is limited to 10 MiB |
| Anything unexpected | Logged and dropped; the worker goes on |
| Backend stops | **What is in the queue is lost.** The issue asks for a queue, and the broker doesn't retry. Keeping events in the database would add a store for a window of milliseconds |

### The subscription's life

A loop every 15 s. No identity: `waiting_for_identity`, and it tries again. Otherwise `POST`; a `409` becomes a `PATCH`, so a restart creates no duplicate and takes up a new address or secret. After that it reads the subscription every 60 s: gone means create it again, `notification.status` of `failed` shows as a degraded check.

Unlike the live updates subscription, this one has no expiry and isn't deleted at shutdown: events should go on being sent, and the next start finds it. For the same reason it isn't deleted when `CALLBACK_BASE_URL` is unset, and the check says that it goes on delivering until deleted in the broker.

| State | Check |
|---|---|
| `not_configured` (no `CALLBACK_BASE_URL`) | `ok`, and left out of the overall result, as for the dataspace |
| `waiting_for_identity` | `degraded` |
| `active` | `ok` |
| `delivery_failing` | `degraded` |
| `failed` | `error` |
| `no_delivery_in_tenant` | `degraded` |

### Alerta's side

A small plugin in `backend/alerta/plugin/`, loaded by Alerta's plugin mechanism. It sends each received alert to `XANA_EVENTS_URL` with the secret, with a 3 second limit, and never fails the alert: a stopped backend doesn't affect Alerta. The local environment loads it with `--profile alerts`.

**What the platform lacks:** its Alerta chart installs plugins from one fixed repository by name, and has `PLUGINS = ['blackout']`. Using this plugin there needs an image or a chart change on the platform, which this change doesn't make.

Alternative: the backend polls Alerta, which needs nothing on the platform. It isn't what the issue describes (`POST /events/alert`), and it would need its own record of what it has seen. A maintainer may prefer it.

### A run's source

`operator`, `ngsi` or `alert`, stored with the run and the incident, and shown in lists and the run view. A reopened incident is an operator's act, so it is `operator`. Existing rows read as `operator`.

## Architectural implications

- A second way in, and the first that doesn't start with an operator: `architecture.md`'s Event Layer describes it, and is corrected for the identity and for which events start a run.
- New secrets, added to redaction. No new runtime dependency in the backend.

## Alternatives for the queue

An external queue such as Kafka is on the platform, but the issue asks for a queue and a worker in the backend, and the backend is one process by design (`helm/charts/xana-pdt`: one replica).
