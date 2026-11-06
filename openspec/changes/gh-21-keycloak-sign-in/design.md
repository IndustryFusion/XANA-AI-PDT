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

- **A (recommended for now, implemented): one session per process.** Whoever signs in supplies the token for all platform calls, and every browser shows that session. Signing out ends it for everyone. This is the smallest change, and it suits the single-operator installations in use today. Its limit is that actions aren't attributed to separate operators, and a second operator's sign-in replaces the first.
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

**Refresh in the background, 60 seconds before expiry.** A failed refresh is retried every 5 seconds, and after 5 failures the session ends, so a passing outage doesn't sign an operator out. Alternative: refreshing on demand, which delays the first call after a quiet period and can't tell the UI that a session has ended.

**Keycloak is optional, through `KEYCLOAK_URL`.** With no URL, sign-in is off and the app opens as it does today, so the local environment and its tests need no identity provider. In the local environment, Keycloak is under a Compose profile. Alternative: always on, which slows every local start and every integration run.

**A backend that can't be reached while the UI loads counts as sign-in off.** The existing requirement says a stopped backend affects only the areas it serves, and session is now one of them. So the app opens, and each area shows its own state. This exposes nothing: there is no backend to read from, and the mock areas hold sample data only. Once the backend has answered, a failed check stays a failure, as it is no proof of expiry. If the backend returns while the app is open with sign-in on, a reload asks for sign-in. Alternative: showing only a session error, which breaks that requirement.

**Tokens stay in memory.** Nothing is written to disk, and `session` responses carry the expiry time, never a token.

## Architectural implications

`architecture.md` says sign-in belongs to a later phase; this delivers it, and the section is updated. The agent stays read-only, and gets its token through a function, so the agent package has no dependency on Keycloak. The workflow's handling of partial data covers a refused broker.

## Risks / Trade-offs

- [The open API means anyone with network access can use the operator's token] → Decision 2, stated in the README and install notes. Limit network access until it is decided.
- [The password passes through the backend] → It is used once, never stored or logged, and a test confirms it.
- [Single session] → Decision 1.

## Open Questions

Decisions 1, 2 and 3 above.
