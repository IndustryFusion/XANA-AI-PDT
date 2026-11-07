# Proposal

Issue: #19

## Why

The backend can select a model provider by configuration, but the path to a working model has gaps. Long prompts can be truncated on Ollama, a malformed answer gets only one retry, an OpenVINO Model Server deployment is not named or checked, and operators cannot see which model the agent is using. A run started while the model is down fails only after the run has begun.

## What Changes

- Pass the context size to Ollama, pass the answer structure as the model's format, accept answers given in content or tool calls, turn reasoning off, and retry a malformed answer up to three times.
- Name OpenVINO Model Server and other OpenAI-compatible servers in the spec, allow them to run without an API key, and make the health check work against them.
- Add a display name for the provider, and a structured model list in the health report, shown on the System screen.
- Check that the model is available before a run or a new round starts, and refuse quickly with 503 if it is not.
- Add optional Langfuse tracing, off unless configured, which also works when Langfuse is not installed.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `backend/service-runtime`: Language model selection, model settings, model list in health, optional tracing.
- `backend/diagnostic-workflow`: Model failure, with up to three retries.
- `backend/run-api`: Model readiness before a round starts.
- `operator-ui/system-health`: Model list on the System screen.

## Impact

- `backend/`: `app/config.py`, `app/health.py`, `app/main.py`, `app/runs/manager.py`, the agent package's model call, new optional tracing, `.env.example`, `compose.yaml`, `README.md`.
- `frontend/`: System screen, data interface shape, mock health, `docs/data-interface.md`.
- `architecture.md`: Key Variable Groups and "Model calls".
- New optional dependency group `tracing`.

## Out of Scope

- Models used only for document retrieval (#18).
- A UI for selecting a provider. Selection stays in configuration.
- Helm settings, which #20 adds.
