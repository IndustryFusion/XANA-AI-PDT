# Proposal

Issue: #28

## Why

Escalation is a mock, and the backend's preflight always says no. An operator who can't resolve an incident needs to send it to the machine builder through the dataspace, sharing only what policy allows.

## What Changes

- `GET /api/agent/escalate-preflight/{id}` reports whether escalation is possible, with a reason for each failure, the recipient, and what would be sent.
- `POST /api/agent/escalate/{id}` finds the builder and matches it to a compatible peer, filters the data to `DATA_SHARING_POLICY`, adds a `policy_check` step, sends the machine data with `POST /outbox/files` and the incident with `POST /outbox/messages` as a `request`, and moves the run to `awaiting_machine_builder` with an `ESC-…` reference.
- Outbox status is polled and shown: `notified` as `delivered`, `error` and `rejected` as `failed`.
- The escalation statuses in the run model, with migrations and restart recovery. Incidents record the builder, conversation reference and outcome.
- A failed send is shown, and the run stays as it was, so it can continue or try again.

**Decision the issue asks for:** escalation is possible from both `awaiting_input` and `awaiting_confirmation`, as the interface allows. An operator who doubts a proposed resolution has the same need as one who was asked a question, and neither state has an action that would be lost.

## Capabilities

### New Capabilities

- `backend/escalation`: Preflight, data sharing, sending and delivery.

### Modified Capabilities

- `backend/run-api`: Escalation statuses, routes, and what a run and its stream hold.
- `backend/incident-records`: Builder, conversation reference and outcome.
- `operator-ui/data-source`: The backend source serves `escalate` and `getOutboxStatus`.

## Impact

- `backend/`: new `app/runs/escalation.py`, `app/dataspace/sharing.py`, `migrations/005_escalation.sql`; changes in `app/dataspace/gateway.py`, `app/runs/manager.py`, `app/runs/model.py`, `app/memory/store.py`, `app/api/runs.py`, `app/main.py`.
- `frontend/`: `src/data/sources/backend/runs.js`, `http.js`, the waiting panel, `docs/data-interface.md`.
- `architecture.md`: API Layer, Escalation flow, Policy-gated data sharing, Memory Layer.

## Out of Scope

- Receiving anything, the conversation, closing it, and sending `close` when a run with a conversation is stopped: #29.
- Any change to the dataspace: it doesn't enforce capability access, so this is XANA's filter.
