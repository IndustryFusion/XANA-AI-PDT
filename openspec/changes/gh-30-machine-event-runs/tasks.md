# Tasks

## 1. Backend

- [x] 1.1 Add the settings and migration; verify config tests naming each variable, against PostgreSQL
- [x] 1.2 Add the service identity; verify renewal, retries and refusal with a stub, and a real token from Keycloak
- [x] 1.3 Add the routes with their check; verify that every unauthenticated call is refused, and nothing is queued
- [ ] 1.4 Add the queue and worker; verify that only a triggered run in progress holds events up, each failure in the design, and concurrent events
- [x] 1.5 Add the subscription and its check; verify each state with a stub, including `409` and a lost subscription
- [x] 1.6 Use the service identity for triggered runs only; verify with a recording broker which token each kind of run sends, also after a restart
- [x] 1.7 Record the source on runs and incidents; verify against PostgreSQL

## 2. Alerta

- [x] 2.1 Add the plugin and load it locally; verify with a real Alerta, including a stopped backend not affecting Alerta

## 3. Frontend

- [x] 3.1 Carry and show `source`; verify with source and component tests and shapes from a real backend

## 4. Verification with real services

- [ ] 4.1 A status change on a real Scorpio starts one run, with an incident, for the right machine, and the same value again, once that run has paused, starts another
- [x] 4.2 An alert from a real Alerta starts a run
- [ ] 4.3 A restart with real services: no duplicate subscription, and a paused run holds no event up
- [x] 4.4 Data with full IRIs and a context: the subscription matches, on a real Scorpio
- [x] 4.5 Add these as a test in CI
- [ ] 4.6 The real platform, as the issue asks to confirm first. **Not possible from here**

## 5. Documents

- [x] 5.1 Update `backend/README.md`, `backend/.env.example`, `helm/README.md`, the chart's values, `frontend/docs/data-interface.md` and `architecture.md`; verify by search and the chart's render test
