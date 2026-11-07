# Proposal

Issue: #36

## Why

One session per backend process, and an open API, were accepted in `gh-21-keycloak-sign-in` for the first installations. While any operator is signed in, anyone who can reach the app can pass the sign-in screen, start runs with that operator's token, read the operator's name and e-mail, and sign the operator out. Until this is delivered, XANA must run on a restricted network with TLS.

There is a second gap: **`/ws/run/{run_id}` doesn't check `Origin`, while `/api/ngsi/ws`, in open pull request #39, does.** A browser sends cookies on a WebSocket and doesn't apply the same-origin rule to it, so any web page an operator opens could read a run's stream. A cookie session would make that worse, so it is closed here.

**This proposal holds three decisions for a maintainer, in `design.md`. The requirements below are written for the recommended options, and change with the decisions. Nothing is implemented until a maintainer has decided and added `spec-approved`.**

## What Changes

- **Per-operator sessions:** each browser has its own session, with its own tokens and refresh, and one operator's sign-in or sign-out leaves the others alone.
- **API protection:** with sign-in on, routes and streams refuse a request without a valid session, apart from `/healthz`, `/api/auth/config`, `/api/auth/connect` and `/api/auth/status`. `/events/*` keep their own secret.
- **Streams:** both streams check `Origin` by one rule and the session cookie, before anything is sent, and end when the session ends.
- **Requests that change something:** must come from an allowed origin, as a second check next to the cookie's `SameSite`.
- **Run identity:** whose token each round of a run uses, including when a run outlives its session. This also closes the gap `gh-30-machine-event-runs` leaves, where anyone can answer a triggered run's question and read the result.
- **Session storage:** tokens stay in the backend's memory, and a restart signs everyone out. The browser holds only a random reference, in a cookie it can't read.
- **TLS:** the default deployment refuses to accept a password over plain HTTP, unless an explicit setting allows it.
- **UI:** the header, session section and countdown show the operator's own session, and any `unauthorized` answer leads to the sign-in screen.

## Decisions for a maintainer

Full alternatives are in `design.md`.

1. **Backend-held sessions with a cookie, or the browser sending a bearer token.** Recommended: backend-held, with a cookie.
2. **How a run continues after the operator who started it signs out.** Recommended: it goes on under the service identity if one is configured, and otherwise without a token, where what it can't read shows as an unavailable source. A paused run waits for an answer as it does today.
3. **Whether sign-in stays a password grant through the backend, or moves to a browser redirect.** Recommended: it stays, for this change.
4. **Which identity the machine events subscription uses, with sessions per operator.** Not one of the issue's three: it arises from `gh-30-machine-event-runs`. Recommended: the service identity only, and without one the subscription waits and says so.

## Capabilities

### New Capabilities

- `backend/api-protection`: Which routes need a session, what a refusal is, and the origin check.
- `backend/run-identity`: Whose token a run uses.

### Modified Capabilities

- `backend/machine-events`: A triggered round and the subscription no longer fall back to a signed-in operator's token. Comes from `gh-30-machine-event-runs`, so this comes after that change is archived.
- `backend/authentication`: A session per browser, with its reference in a cookie. This changes `gh-21-keycloak-sign-in`'s requirements, so it comes after that change is archived (#37).
- `backend/run-stream`: Origin and session checks, and ending with the session.
- `backend/local-environment`: Plain HTTP is allowed explicitly.
- `deployment/kubernetes`: The default doesn't accept passwords over plain HTTP; the warning is updated.
- `operator-ui/data-source`: Sending the cookie, and reacting to `unauthorized`.
- `operator-ui/system-health`: The session section shows the operator's own session.

## Impact

Paths below include what the open pull requests #38 to #47 add, which this change has to build on. **It should be implemented after they are merged,** or it will have to be redone in each.

- `backend/`: `app/auth.py` (one session becomes a store of them), a new request dependency on every router, `app/api/stream.py`, `app/ngsi/stream.py` and `app/api/ngsi.py` (the origin rule, and the session on the stream), `app/ngsi/live.py`, `app/ngsi/broker.py`, `app/ngsi/history.py`, `app/runs/manager.py` and `app/main.py` (tokens by session or by run, no longer one callable), `app/health.py`, `app/config.py`.
- `frontend/`: `src/data/sources/backend/http.js`, `runs.js`, `entities.js`, `session.js`, `src/app/session.jsx`, `docs/data-interface.md`.
- `helm/`: `README.md`, Ingress and values.
- `architecture.md`: Backend API table, Authentication, Key Design Decisions.

## Out of Scope

- Roles and permissions per operator: every signed-in operator can do the same in XANA, and the platform decides what their token may read.
- A service identity for runs with nobody signed in: that is #30, in `gh-30-machine-event-runs`. This change uses it, and doesn't define it.
- Attributing actions in incident records to operators. It becomes possible with this change, but no issue asks for it. See Open questions in `design.md`.
- Sign-in being optional: with `KEYCLOAK_URL` unset, the API stays open, as for local development.
