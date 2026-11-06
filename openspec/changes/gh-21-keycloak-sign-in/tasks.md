# Tasks

## 1. Backend

- [x] 1.1 Add the settings `KEYCLOAK_URL`, `KEYCLOAK_REALM`, `KEYCLOAK_CLIENT_ID` and `FACTORY_ID`; verify with config tests, and that `.env.example` lists them
- [x] 1.2 Add the session: sign-in, claims, refresh 60 seconds before expiry, end after 5 failures, sign-out; verify with tests against a fake identity provider, and against a real Keycloak
- [x] 1.3 Add `/api/auth/config`, `connect`, `logout` and `status`, with `unauthorized` errors; verify with API tests for each result, including sign-in turned off
- [x] 1.4 Send the token to Scorpio from the agent's source, the machine lookup and the health check; verify with tests against a broker that refuses a missing token
- [x] 1.5 Add the place to start what depends on sign-in; verify with a test that it runs after sign-in, and that a failure doesn't stop the sign-in

## 2. Frontend

- [x] 2.1 Serve session operations from the backend source, leaving `getFactory` on the mock until #27; verify with the source tests and shape fixtures recorded from a real backend
- [x] 2.2 Show the token's time left in the Session section; verify with a component test
- [x] 2.3 Keep the mock's sign-in hint off the backend source; verify with a test

## 3. Local environment and deployment

- [x] 3.1 Add Keycloak to `backend/compose.yaml` under a profile, with a realm import holding `iff`, public client `scorpio`, the claim mappers and a test user; verify by signing in against it
- [x] 3.2 Add the Keycloak settings to the chart and Helmfile; verify with `helm template`, and in the `Deployment` workflow

## 4. Verification

- [x] 4.1 Against a real Keycloak: sign in, stay signed in beyond the token's life, sign out; verify the token changes and the session stays valid
- [x] 4.2 Wrong credentials and an unreachable provider give distinct errors; verify in the API and on the sign-in screen
- [x] 4.3 A run reads from a broker that requires a token; verify with a test, and record what was run against a real broker
- [x] 4.4 A restart behaves as the design states; verify the session is gone, and a run started without a token shows the source as unavailable
- [x] 4.5 Tokens and passwords never appear in logs or API responses; verify with a test over a full sign-in, refresh and sign-out

## 5. Documents

- [x] 5.1 Update `backend/README.md`, `helm/README.md`, `frontend/docs/data-interface.md` and `architecture.md`, including the limit in decision 2; verify by searching for each setting

## 6. Integration check

- [x] 6.1 Run backend and frontend tests, lint and `openspec validate --all --strict`; verify they pass locally and in CI
- [x] 6.2 Check each scenario in the delta specs and report the result per scenario in the Pull Request; verify the report covers every scenario

## 7. Review follow-ups

- [x] 7.1 A failed configuration read doesn't sign out a working operator; verify with the real session gate on the backend source
- [x] 7.2 A backend out of reach at load isn't treated as sign-in off for good, and the gate recovers without a reload; verify with the real session gate
- [x] 7.3 Unexpected provider answers are failures that count, log nothing secret, and don't break sign-out or close, and the database always closes; verify with tests for each answer form
- [x] 7.4 Session changes happen one at a time; verify with concurrent tests for two sign-ins, sign-out during sign-in, and a refresh during sign-out
- [x] 7.5 A failed sign-out shows an error and keeps the app open; verify with a component test
- [x] 7.6 The documents state what decisions 1 and 2 mean, and warn about plain HTTP; verify by reading `design.md` and `helm/README.md`
- [x] 7.7 The full session test really refreshes; verify it fails if no refresh happens
- [x] 7.8 Sign-in refusals tell credentials from the client, and a replaced session ends at the provider; verify with tests
- [x] 7.9 The header's name and the token countdown follow the session; verify with component tests

## Workflow follow-up

- After merge, run `/opsx:archive gh-21-keycloak-sign-in` in a follow-up Pull Request from a fork, with `Closes #21` in its description.
