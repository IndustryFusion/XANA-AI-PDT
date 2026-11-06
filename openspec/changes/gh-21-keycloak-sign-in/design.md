# Design

## Context

The UI already has a sign-in screen, a session gate and a Session section on the data interface. The backend has no session, its API is open (`architecture.md` lists protection as a later phase), and Scorpio requests carry no token. The platform's Keycloak has realm `iff` and a public `scorpio` client with direct access grants, which sets the `ifric_company_id` and `ifric_factory_id` claims.

## Goals / Non-Goals

**Goals:**

- An operator can sign in, stay signed in beyond a token's life, and sign out.
- Platform calls carry the token when one exists.

**Non-Goals:**

- Authenticating callers of the backend's own API (see decision 2).

## Decisions for maintainers

The issue asks for these three to be presented with alternatives. Each is implemented as recommended, which is closest to how the backend works today. **All three need a maintainer's decision.**

### 1. One session per backend process, or one per operator

- **A (recommended for now, implemented): one session per process.** Whoever signs in supplies the token for all platform calls, and every browser shows that session. This is the smallest change, and it suits the single-operator installations in use today. Its limits are serious on any shared network, because the backend doesn't know who is calling:
  - While anyone is signed in, **any visitor passes the sign-in screen** without credentials.
  - Any visitor can read the signed-in operator's name and e-mail.
  - Any visitor can sign the operator out, or replace the session with their own.
  - Actions aren't attributed to separate operators.
- **B: one session per operator**, with a cookie or token between browser and backend. This attributes actions properly, and is needed for several operators working at once. It also needs decisions on where sessions live across restarts, and which operator's token a background run uses, so it is a larger change that builds on decision 3.

### 2. Whether the backend's own API requires a session

- **A (implemented): stays open**, as it is today, and the sign-in screen is only the UI's gate. It is simple and changes no client. Its limit is real: **anyone who can reach the backend can start runs, which read platform data with the signed-in operator's token.** A deployment must limit network access to it.
- **B (recommended next): require a session on API and stream routes.** This closes that gap, with a small change once decision 1 is settled. With option 1A it would only prove that somebody has signed in, so it gives real protection only with 1B or with a check of a token passed by each browser.

### 3. What identity the agent uses when nobody is signed in

The platform's `scorpio` client is public, and has no service account, so an unattended agent has no identity of its own.

- **A (implemented): none.** Calls go without a token. On a broker that requires one, they fail, and the run shows that the source is unavailable. Nothing is stored, so a restart needs a new sign-in, and runs resumed before that have no token.
- **B (recommended for #30): a service account** from a new confidential client, used when nobody is signed in. This needs a change in the platform's Keycloak setup, and is needed before event-triggered runs can work.
- **C: storing the refresh token** so a session survives a restart. This keeps a long-lived credential on disk, and still leaves no identity after sign-out.

## Other decisions

**The backend signs in with the password grant on the platform's public client.** This is what the platform's `scorpio` client allows. Alternative: a browser redirect flow, which needs a redirect URI added to the platform's client, and changes the existing sign-in screen.

**Tokens are requested through the configured URL, which must match the token issuer.** Services check the issuer, so `KEYCLOAK_URL` is the external address. Alternative: an internal address, which would give tokens the broker refuses.

**Claims are read from the token without verifying its signature.** The backend gets the token directly from Keycloak over the configured address, and only uses claims for display. It makes no access decision from them. Services receiving the token verify it. Alternative: verifying against the realm's keys, which adds a dependency and a fetch for no gain here.

**Refresh in the background, 60 seconds before expiry.** A failed refresh is retried every 12 seconds, and after 5 failures the session ends. Those tries last for most of the 60 second margin, so a provider restart doesn't sign an operator out, and the session ends before its token would. Alternative: refreshing on demand, which delays the first call after a quiet period and can't tell the UI that a session has ended.

**Keycloak is optional, through `KEYCLOAK_URL`.** With no URL, sign-in is off and the app opens as it does today, so the local environment and its tests need no identity provider. In the local environment, Keycloak is under a Compose profile. Alternative: always on, which slows every local start and every integration run.

**A backend that hasn't answered since the UI loaded is reported as out of reach, not as sign-in off.** The existing requirement says a stopped backend affects only the areas it serves, and session is now one of them. So the app opens, and each area shows its own state. The configuration says `backendUnreachable`, and the Session section shows the session as unknown. The session gate checks every 10 seconds, and as soon as the backend answers it applies the real configuration, which asks for sign-in if it is on. This is no access control: backend areas have nothing to show without the backend, and the mock areas hold sample data only. Once the backend has answered, a failed read stays a failure, as it is no proof that sign-in is off or has expired, so an outage doesn't sign an operator out. Alternative: showing only a session error, which breaks that requirement.

**A failed sign-out says so.** The operator stays in the app with an error, as the session may still be active. Showing the sign-in screen would suggest it had ended. Alternative: signing out in the browser anyway, which leaves a live session behind that a reload walks straight back into.

**Session changes happen one at a time.** Sign-in, sign-out and refresh share a lock, so there is one refresh loop, and a sign-out during a sign-in ends signed out. A sign-in that replaces a session ends the old one at the provider. An unexpected answer from the provider is a failure: `unavailable` at sign-in, leaving any existing session alone, and a counted failure at refresh.

**Tokens stay in memory.** Nothing is written to disk, and `session` responses carry the expiry time, never a token.

## Architectural implications

`architecture.md` says sign-in belongs to a later phase; this delivers it, and the section is updated. The agent stays read-only, and gets its token through a function, so the agent package has no dependency on Keycloak. The workflow's handling of partial data covers a refused broker.

## Risks / Trade-offs

- [The password crosses the Ingress in plain HTTP when no TLS Secret is set, which is the default environment's setting] → `helm/README.md` warns about this. Use TLS outside a local cluster.
- [The open API means anyone with network access can use the operator's token] → Decision 2, stated in the README and install notes. Limit network access until it is decided.
- [The password passes through the backend] → It is used once, never stored or logged, and a test confirms it.
- [Single session] → Decision 1.

## Open Questions

Decisions 1, 2 and 3 above.
