# Tasks

## 1. Backend

- [ ] 1.1 Add the settings `KEYCLOAK_URL`, `KEYCLOAK_REALM`, `KEYCLOAK_CLIENT_ID` and `FACTORY_ID`; verify with config tests, and that `.env.example` lists them
- [ ] 1.2 Add the session: sign-in, claims, refresh 60 seconds before expiry, end after 5 failures, sign-out; verify with tests against a fake identity provider, and against a real Keycloak
- [ ] 1.3 Add `/api/auth/config`, `connect`, `logout` and `status`, with `unauthorized` errors; verify with API tests for each result, including sign-in turned off
- [ ] 1.4 Send the token to Scorpio from the agent's source, the machine lookup and the health check; verify with tests against a broker that refuses a missing token
- [ ] 1.5 Add the place to start what depends on sign-in; verify with a test that it runs after sign-in, and that a failure doesn't stop the sign-in

## 2. Frontend

- [ ] 2.1 Serve session operations from the backend source, leaving `getFactory` on the mock until #27; verify with the source tests and shape fixtures recorded from a real backend
- [ ] 2.2 Show the token's time left in the Session section; verify with a component test
- [ ] 2.3 Keep the mock's sign-in hint off the backend source; verify with a test

## 3. Local environment and deployment

- [ ] 3.1 Add Keycloak to `backend/compose.yaml` under a profile, with a realm import holding `iff`, public client `scorpio`, the claim mappers and a test user; verify by signing in against it
- [ ] 3.2 Add the Keycloak settings to the chart and Helmfile; verify with `helm template`, and in the `Deployment` workflow

## 4. Verification

- [ ] 4.1 Against a real Keycloak: sign in, stay signed in beyond the token's life, sign out; verify the token changes and the session stays valid
- [ ] 4.2 Wrong credentials and an unreachable provider give distinct errors; verify in the API and on the sign-in screen
- [ ] 4.3 A run reads from a broker that requires a token; verify with a test, and record what was run against a real broker
- [ ] 4.4 A restart behaves as the design states; verify the session is gone, and a run started without a token shows the source as unavailable
- [ ] 4.5 Tokens and passwords never appear in logs or API responses; verify with a test over a full sign-in, refresh and sign-out

## 5. Documents

- [ ] 5.1 Update `backend/README.md`, `helm/README.md`, `frontend/docs/data-interface.md` and `architecture.md`, including the limit in decision 2; verify by searching for each setting

## 6. Integration check

- [ ] 6.1 Run backend and frontend tests, lint and `openspec validate --all --strict`; verify they pass locally and in CI
- [ ] 6.2 Check each scenario in the delta specs and report the result per scenario in the Pull Request; verify the report covers every scenario

## Workflow follow-up

- After merge, run `/opsx:archive gh-21-keycloak-sign-in` in a follow-up Pull Request from a fork, with `Closes #21` in its description.
