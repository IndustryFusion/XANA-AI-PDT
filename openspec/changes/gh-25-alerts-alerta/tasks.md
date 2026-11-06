# Tasks

## 1. Backend

- [x] 1.1 Add the settings `ALERTA_URL`, `ALERTA_API_KEY`, `ALERTS_REFRESH_INTERVAL_S`; verify with config tests including a missing `/api`, the key in the redactor, and that `.env.example` lists them
- [x] 1.2 Add the routes under `/api/alerta`, with Key authentication; verify against a real Alerta, and with stub tests for each error
- [x] 1.3 Filter free text in the backend; verify text with `:`, quotes and regular expression characters against a real Alerta
- [x] 1.4 Add the read-only alert source; verify the filter with an alert in the rules' form against a real Alerta, and that only GET is sent
- [x] 1.5 Add alerts to observe, hypothesize and the run's evidence; verify duplicates, weights, the limit of 5, one failing entity, and Alerta down

## 2. Frontend

- [x] 2.1 Serve the `alerts` operations from the backend source; verify with source tests and fixtures recorded from a real backend
- [x] 2.2 Show alerts in the observe step, add severities `up` and `down`, and take the default refresh interval from the backend; verify with component tests

## 3. Local environment and deployment

- [x] 3.1 Add Alerta under a profile, with sample alerts; verify the screen through it
- [x] 3.2 Add the settings and secret to the chart; verify with `helm template`

## 4. Verification

- [x] 4.1 All alert operations work on the backend source; verify in a browser against a real Alerta
- [x] 4.2 A run on a machine with an active alert shows it as evidence; verify in a browser
- [x] 4.3 An unavailable Alerta doesn't fail a run; verify with Alerta stopped
- [x] 4.4 A missing `/api` gives a clear error; verify by starting the backend

## 5. Documents

- [x] 5.1 Update `backend/README.md`, `helm/README.md`, `frontend/docs/data-interface.md`, `architecture.md`; verify by searching for each setting

## 6. Integration check

- [x] 6.1 Run backend and frontend tests, lint and `openspec validate --all --strict`; verify locally and in CI
- [x] 6.2 Check each scenario in the delta specs and report per scenario in the Pull Request
