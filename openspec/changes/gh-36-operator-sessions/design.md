# Design

**Status: awaiting a maintainer's decisions and `spec-approved`. Nothing here is implemented.** Each decision below has a recommendation, and the spec deltas are written for it. If a maintainer decides otherwise, the deltas change before any implementation.

## Context

`gh-21-keycloak-sign-in` holds one session per process, in memory, and the API is open. `KeycloakSession.token` is passed as one callable to everything that calls the platform: the broker routes, history, the ontology, the agent's sources, the machine resolver, live updates and the health check. So this is less a change to sign-in than a change to how a token reaches each call.

## Conflicts

- **`gh-21-keycloak-sign-in`'s requirements "Token for platform services" and "Session after a restart" assume one session.** They are modified here, as that change's design already says this comes next.
- **`gh-30-machine-event-runs` uses a triggered run's identity for every round,** whoever answers. Decision 2 changes that for a round an operator's answer starts, which closes the gap that change names. Its requirement has to be modified here, or that change adjusted if it merges later.
- **`gh-30-machine-event-runs` falls back to a signed-in operator's token,** where this design's table gives a triggered run the service identity "or else nothing". That change's requirement "A triggered run while an operator is signed in" and "Not configured", and `service_identity.token() or session.token()` in `app/main.py`, which the subscription uses too, would change: with no service client, a triggered round has no token, and the subscription has no identity unless one is chosen for it. With sessions per operator, "the signed-in operator" no longer means one person. For the subscription this design has no answer of its own: **a maintainer should decide whether it may use an operator's token at all,** or needs a service client.
- **`architecture.md` lists the API without protection.** It is corrected on implementation.

## Decisions for a maintainer

### 1. Backend-held sessions with a cookie, or the browser sending a bearer token

| | A. Backend-held, with a cookie **(recommended)** | B. Browser holds the token, sends a bearer token |
|---|---|---|
| Where tokens are | Only in the backend, as the issue's scope states | In the browser's memory or storage, where any script on the page can read them |
| Refresh | The backend, as today | The browser, which needs the refresh token too |
| Background rounds | The backend has the token for them | The browser would have to hand one over and renew it |
| Forged requests | Possible, since a browser adds cookies by itself, so it needs `SameSite` and an origin check | Not possible, as nothing is sent by itself |
| Streams | The cookie goes with the WebSocket, so the origin check is mandatory | A browser can't set a header on a WebSocket, so it needs a query token, which ends up in logs, or a one-time ticket |
| UI served from another origin | Needs the cookie to be `SameSite=None`, or one host | Works as it is |
| Change to the UI | Small: the same calls, with credentials | Larger: storing, renewing and attaching a token everywhere |

**Recommended: A.** B contradicts the issue's "tokens stay on the server" unless a maintainer drops that, and it moves the refresh logic and an XSS risk to the browser, in exchange for not needing the origin check. **C**, a session reference sent as a header by the UI, gets the worst of both: script-readable, and no use on a WebSocket.

**The cookie:** `xana_session`, a random 256-bit value that refers to the session in memory. `HttpOnly`, `SameSite=Lax`, `Secure` unless plain HTTP is explicitly allowed, `Path=/`, no `Max-Age`, so that it ends with the browser. A new value at every sign-in. `Lax` rather than `Strict`, so that following a link to XANA from another system, such as a ticket, doesn't show the sign-in screen although a session exists. `Lax` sends the cookie only on top-level navigation, and no API call is one.

**Requests that change something (not GET):** `Origin` has to pass the same rule as the streams, if the browser sends one. This is the second check next to `SameSite`. No CSRF token, as JSON bodies and an origin check are enough for a same-origin UI, and it would add state to the UI. Alternative: a CSRF token as well, which helps only with an old browser sending neither `Origin` nor `SameSite`.

### 2. How a run continues after the operator who started it signs out

Which token a round uses, in every case, under the recommended option:

| Round | Token |
|---|---|
| The first round of a run an operator started | That operator's session |
| A round an operator's answer starts (`clarify`, `confirm`, reject, reopen) | **That operator's** session, whoever started the run. The operator is the one asking to read |
| A triggered run's first round | The service identity (`gh-30-machine-event-runs`), or else nothing |
| A round already going when its session ends | The service identity if there is one. Otherwise it goes on without a token, and what it can't read shows as an unavailable source, as today |
| Restored after a restart: all sessions are gone | The same |

| Alternative | For | Against |
|---|---|---|
| **A. Go on under the service identity, or else without a token (recommended)** | No credential is kept after sign-out. A run that is paused just waits, and the next operator's answer gives it their token | The identity changes in mid-run, visible only in a step. Without a service client, a broker that needs a token gives a weaker result |
| B. Keep the operator's refresh token until the run ends | Same identity to the end | Signing out doesn't end what the operator could do, and a provider session stays alive. It surprises anyone who signed out because they were leaving, and it has to be held across a long pause |
| C. Stop the run at sign-out | Simple and clear | A shift change kills every open run, and those waiting for the machine builder too |
| D. Pause until an operator answers | No token without a person | Rounds can't simply pause in the middle, as the workflow has no such point. It adds a status and handling for it to the run model |

**Recommended: A.** A step records `identity: operator | service | none`, so that a weaker result can be explained. The operator's name isn't stored in it: see Open questions.

**This also closes #30's gap.** With a session required under `/api`, and an answer's round using the answerer's token, nobody can use the service identity through `/api`.

### 3. Whether sign-in stays a password grant through the backend, or moves to a browser redirect

| | A. Password grant through the backend **(recommended for this change)** | B. Authorization code with PKCE, by browser redirect |
|---|---|---|
| Platform | Works with the platform's `scorpio` client as it is | Needs redirect URIs added to the platform's client, or a new one. **That is a change on the platform, which this repository can't make** |
| Password | Passes through the backend, in memory, for one request. Needs TLS | Never reaches XANA |
| Multi-factor and single sign-on | Not possible | Whatever Keycloak offers |
| OAuth's direction | The grant is removed in OAuth 2.1 | Current practice |
| Screens | The existing sign-in screen stays | It becomes a redirect; `signIn` goes from the interface; the mock needs its own answer |
| Effort | None | A callback route, `state` and PKCE handling, and new tests |

**Recommended: A for this change, with B as its own issue** once the platform has the redirect URIs. The session design doesn't depend on this choice: under either, the backend ends up holding tokens behind a cookie, so B can follow without touching what this change builds.

## Other decisions

### Protecting the streams

Both `/ws/run/{run_id}` and `/api/ngsi/ws`, in this order, before accepting:

1. **`Origin`**, by one rule shared by both: no origin, the backend's own, or one in `WS_ALLOWED_ORIGINS`. That is the rule `/api/ngsi/ws` has today, moved to one place. A refused page gets 403 on the handshake.
2. **The session,** from the cookie, when sign-in is on. Without one: 403 on the handshake. A browser can't read a handshake's status, so the UI asks `getSession` when a stream fails to open, and shows the sign-in screen if it isn't valid.

With a session:

- **It ends:** when that session signs out, expires or fails its refreshes, its streams close with code `4401`, and the UI asks again. A stream isn't left open on an ended session.
- **No origin:** still allowed, as such a client isn't a web page, but it needs the cookie like anyone else. The origin check protects a browser's cookie from another page. It doesn't identify anyone.
- **Sign-in off:** the origin check still applies to both.
- **Who can watch:** any signed-in operator can watch any run, as roles are out of scope.

**Under the bearer alternative of decision 1,** streams would need a one-time ticket from `POST /api/auth/stream-ticket`, in the query, because a browser can't set a header. The origin check would then add little, as a page would have no way to get a ticket.

**Live updates' single subscription.** Today one broker subscription holds one operator's token in its MQTT address. With several operators, it holds **the service identity's token, if there is one, or else the token of the operator signed in longest**, and moves to the next when that one signs out, with the renewal it has today. Every browser's stream reads from it, after the checks above. So an operator without the MQTT role can see live updates that another's token subscribed to, which is acceptable only because roles are out of scope, and it needs the maintainer's eye. Alternative: one subscription per session, each with its own token and MQTT connection, which is correct per operator, and costs a subscription and a connection each, with the deletion and sweeping multiplied.

### Session storage

In the backend's memory, with one replica as the chart states. **A restart signs everyone out,** as `gh-21-keycloak-sign-in` decided, and the browser's next request gets `unauthorized`. A session ends after 8 hours regardless, or when its refresh token does, or after 5 failed refreshes.

Alternatives: **encrypted in the memory database with `SETTINGS_ENCRYPTION_KEY`**, which survives a restart, and keeps long-lived credentials on disk. **Redis**, which adds infrastructure for several replicas, which nothing else in the backend supports: runs and their streams are in the process too.

Refresh keeps its rules per session: 60 seconds before expiry, 12 seconds between tries, ended after 5 failures. One task wakes for the next one due, rather than a task per session. The number of sessions is limited to 1000, with the oldest ended first, as anyone can try to sign in.

### What stays open

| Route | Why |
|---|---|
| `/healthz` | Probes. The chart's probes use it |
| `/api/auth/config` | Says whether to show the sign-in screen |
| `/api/auth/connect` | Signing in |
| `/api/auth/status` | Answers `valid: false` without a session, so the UI needs no special case |
| `/events/*` | Their own secret |

**`/api/diagnostics` needs a session,** as it shows internal addresses. `helm/README.md`'s check runs from inside the Pod, so that has to move to `/healthz`, or use a fresh session. Alternative: leave it open and strip the details, which gives operators a worse report or two code paths.

A refusal is `unauthorized` (401), as today's error shape. With sign-in off, nothing is refused.

### TLS

The backend refuses `POST /api/auth/connect` with `invalid` unless the request came over TLS, or `ALLOW_INSECURE_SIGN_IN=true`. It knows from the connection, or `X-Forwarded-Proto` from a proxy that `FORWARDED_ALLOW_IPS` trusts, which the chart sets for its Ingress. The password never leaves the browser's request if refused, but it has crossed the network by then, so the check alone isn't enough:

- **The chart fails to render** with `keycloakUrl` set, no `ingressTlsSecret`, and no `allowInsecureSignIn`. So the default deployment can't send a password over plain HTTP by accident.
- **The UI doesn't show the password form** on a plain HTTP page unless the configuration says it's allowed: `/api/auth/config` gains `insecure_allowed`.
- **The local environment** sets `ALLOW_INSECURE_SIGN_IN=true`, on addresses bound to `127.0.0.1`.

Alternatives: **HSTS and a redirect only**, which don't protect a first visit. **A warning only**, which is today's state.

### Logs

The session reference and tokens join the redactor when created. Access logs from uvicorn don't hold cookies, and a test checks a full session's log for all of them.

## Architectural implications

- Every call to the platform has to know its identity, so the single token callable goes. Routes take it from the request's session, and rounds from their identity. Reading it from a context variable set by a dependency is the smallest change, as sources already take a callable, and it carries into a round's task.
- `GatewayConnection` and the dataspace token stay per process: the participant is the factory, not the operator. Its client ID comes from the `ifric_company_id` of the operator who signs in first, or `GATEWAY_CLIENT_ID`.
- No new runtime dependency.

## Open questions

- **Attribution.** With per-operator sessions, steps could record who answered, which a maintainer may want in incident records. Personal data then ends up in stored traces, and possibly in what is escalated to a machine builder, so it needs its own decision, and it isn't in this proposal.
- **A UI served from another origin** needs `SameSite=None` and CORS with credentials. Nothing does this today. It stays unsupported unless a maintainer asks.
