# Tasks

**Not to be started before a maintainer has decided the three decisions in `design.md` and added `spec-approved`. They assume the recommended options, and #38 to #47 merged.**

## 1. Sessions

- [ ] 1.1 Replace the single session with a store of sessions, each with its tokens, keyed by a random reference; verify with two sessions: their own tokens and refresh, and one's failure leaving the other
- [ ] 1.2 Set the cookie at sign-in and clear it at sign-out, with its attributes; verify each attribute, and a new value at each sign-in
- [ ] 1.3 Refresh, limits and expiry per session; verify with a fake clock, including the limit of sessions and concurrent sign-ins
- [ ] 1.4 A restart signs everyone out; verify a stored reference is refused after one

## 2. API protection

- [ ] 2.1 Require a session on every route except those listed; verify with a test that walks every route of the app, so that a new route can't be left open
- [ ] 2.2 Check `Origin` on requests that change something; verify allowed, refused and absent, and with sign-in off
- [ ] 2.3 Tokens by request, not one callable, in the broker routes, history, ontology and health; verify with a recording broker that each operator's calls carry their own token, concurrently

## 3. Streams

- [ ] 3.1 One origin rule on both streams; verify `/ws/run` refuses a foreign page, as `/api/ngsi/ws` does, on a real server
- [ ] 3.2 The session on both streams; verify none, an expired one and a valid one
- [ ] 3.3 Close a session's streams when it ends; verify sign-out, expiry and failed refreshes, each with `4401`, leaving another operator's stream open
- [ ] 3.4 Live updates' subscription under the service identity or the longest-signed-in operator; verify it moves when that operator signs out, against real Scorpio and EMQX with the platform's check

## 4. Run identity

- [ ] 4.1 Give each round its identity, per the design's table; verify each row with a recording broker, including a session ending during a round, and a restart
- [ ] 4.2 Record the identity on a step; verify in a run's steps
- [ ] 4.3 Remove the fallback to an operator's token from triggered rounds and the subscription, per decision 4; verify that with no service client and an operator signed in, a triggered round has no token and the subscription waits, and the check says so

## 5. TLS

- [ ] 5.1 Refuse a password without TLS, unless allowed; verify direct, behind a trusted proxy, and a forged header from an untrusted one
- [ ] 5.2 Fail the chart's render without TLS or the setting; verify in the render test and `helmfile template`
- [ ] 5.3 Don't show the password form when it would be refused; verify in a component test

## 6. UI

- [ ] 6.1 Send credentials, and go to the sign-in screen on `unauthorized`, from any area and stream; verify with source and component tests
- [ ] 6.2 Two browsers against a real Keycloak: their own names, and signing one out leaves the other; verify in a browser
- [ ] 6.3 Without a session, every protected route and stream refuses, and the sign-in screen shows; verify in a browser

## 7. Verification and documents

- [ ] 7.1 Tokens and the reference in no log and no response, over a full session with two operators; verify with a test reading the real log
- [ ] 7.2 Update the warning in `helm/README.md`, `backend/README.md`, `frontend/docs/data-interface.md` and `architecture.md`; verify by search
