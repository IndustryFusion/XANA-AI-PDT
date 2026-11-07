# Proposal

Issue: #56

## Why

The backend reads `LANGFUSE_HOST`, but the chart doesn't pass it, so a deployment with Langfuse keys sends its traces to Langfuse's cloud. Operators who run their own Langfuse server can't point XANA at it through the chart. Newer Langfuse clients name the same setting `LANGFUSE_BASE_URL`.

## What Changes

- The chart takes the Langfuse address as a value (`XANA_LANGFUSE_HOST` for Helmfile) and passes it to the backend as `LANGFUSE_HOST` in its configuration. The keys stay in the Secret, as now.
- The backend accepts `LANGFUSE_HOST` or `LANGFUSE_BASE_URL`. If both are set to different addresses, it stops at startup with a message naming both.
- With keys set and no address, traces go to Langfuse's default, as now. Without keys, nothing is traced and nothing is sent, whatever the address.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `backend/service-runtime`: The tracing address and its two names.
- `deployment/kubernetes`: The chart passes the tracing address.

## Impact

- `backend/`: `app/config.py`, `app/tracing.py`, tests; `.env.example`, `README.md`.
- `helm/`: `values.yaml.gotmpl`, the chart's values and configuration, `README.md`, the render check.
- `architecture.md`: the configuration table.

## Out of Scope

- Deploying a Langfuse server.
- Tracing anything other than model calls.
- Making an address required when keys are set: the default stays Langfuse's.
