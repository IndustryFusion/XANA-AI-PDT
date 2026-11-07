# Proposal

Issue: #25

## Why

The Alerts screen runs on the mock, and the agent diagnoses a machine without knowing its active alerts, which are direct evidence.

## What Changes

- Backend routes under `/api/alerta`: `alerts`, `alerts/count`, `alert/{id}`, `alert/{id}/action`, `environments` and `services`, calling Alerta with its Key authentication.
- Settings: `ALERTA_URL`, `ALERTA_API_KEY`, `ALERTS_REFRESH_INTERVAL_S`. A URL without `/api` stops the backend with a clear message.
- Serve the `alerts` area from the backend source: severity bar, filters, table, bulk actions, detail, actions and auto-refresh.
- In observe, read `open` and `ack` alerts for the machine and up to 5 related entities, remove duplicates, weight by age, and pass them to hypothesize. Add them to the run's evidence, and keep them with the machine data for #28.
- A failure on one entity leaves the run going with the rest, and the source shows as unavailable. The agent only reads alerts.
- Alerta in the local environment under a profile, with sample alerts in the form the platform's rules produce.

## Capabilities

### New Capabilities

- `backend/alerts-api`: Alerts routes over Alerta.

### Modified Capabilities

- `backend/diagnostic-workflow`: Active alerts as evidence; degradation and read-only rules extended to them.
- `backend/local-environment`: Optional Alerta.
- `operator-ui/data-source`: The backend source serves alerts.
- `operator-ui/run-view`: Alerts shown in the observe step.

## Impact

- `backend/`: new `app/api/alerta.py`, `agent/xana_agent/sources/alerta.py`; changes in `app/config.py`, `app/main.py`, `agent/xana_agent/steps/`, `agent/xana_agent/prompts/`, `agent/xana_agent/testing.py`, `sample_data/`, `compose.yaml`, `.env.example`, `README.md`.
- `frontend/`: new `src/data/sources/backend/alerts.js`; `StepFeed.jsx`, severities, `docs/data-interface.md`.
- `helm/`: Alerta settings and secret.
- `architecture.md`: Data sources, Key Variable Groups.

## Out of Scope

- Alert actions by the agent. They are for operators.
- The webhook that starts runs from alerts (#30), and handing data to #28 itself.
- Changes to the platform's rules or its Alerta.
