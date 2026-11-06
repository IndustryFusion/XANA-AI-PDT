# Tasks

## 1. Backend

- [x] 1.1 Add the settings `MQTT_BROKER_URL`, `MQTT_MGMT_URL`, `MQTT_BROKER_NOTIFY_URL`, with the issue's defaults; verify with config tests, and that `.env.example` lists them
- [x] 1.2 Add the subscription lifecycle: create, renew on rotation and before expiry, recreate if gone, delete; verify with tests against a fake broker and a controlled clock
- [x] 1.3 Add the MQTT connection with reconnect, using the newest token; verify with a real EMQX stopped and started
- [x] 1.4 Add `/api/ngsi/ws` with per-client filters and bounded queues; verify concurrent clients each get all of their changes, and a slow client doesn't hold up others
- [x] 1.5 Add `/api/ngsi/subscription-health`; verify each state, and that it holds no endpoint or token
- [x] 1.6 Start after sign-in, or at startup with sign-in off, and stop on sign-out and shutdown; verify with tests, and no subscription left in a real broker
- [x] 1.7 Mask tokens in addresses and JWTs in the log filter; verify with a test, including a library's log line and the local logs of a real run

## 2. Frontend

- [x] 2.1 Serve `subscribeEntities` and `getLiveUpdateHealth` from the backend source; verify with source tests for events, errors and shapes
- [x] 2.2 Forward the WebSocket in the development server; verify in a browser

## 3. Local environment and deployment

- [x] 3.1 Add EMQX under a profile; verify a change reaches the UI through it
- [x] 3.2 Add the settings to the chart; verify with `helm template`

## 4. Verification

- [x] 4.1 A change in Scorpio reaches an open explorer with no reload; verify in a browser against a real Scorpio and EMQX
- [x] 4.2 Updates continue after a rotation, past the old token's expiry; verify against a real Keycloak with short tokens
- [x] 4.3 EMQX requiring a token and a role: an operator with the role subscribes, one without is refused and the state says so; verify with the stand-in described in the design
- [x] 4.4 Losing the broker shows a clear state, and updates resume when it returns; verify in a browser
- [x] 4.5 No subscription is left after sign-out and shutdown; verify in the real broker

## 5. Documents

- [x] 5.1 Update `backend/README.md`, `helm/README.md`, `frontend/docs/data-interface.md`, `architecture.md`, including the required role; verify by searching for each setting

## 6. Integration check

- [ ] 6.1 Run backend and frontend tests, lint and `openspec validate --all --strict`; verify locally and in CI
- [ ] 6.2 Check each scenario in the delta specs and report per scenario in the Pull Request
