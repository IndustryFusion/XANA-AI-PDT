# Proposal

Issue: #27

## Why

Peers on the Dataspace screen show only an identifier, and the machine's builder and the factory's details are mock data. Escalation (#28) has to know a machine's builder.

## What Changes

- Backend routes under `/api/ifric`: `config`, `status`, `factory`, `resolve`, `resolve-builders`, on the IFRIC registry at `IFRIC_URL`, with the dataspace token from #26.
- The backend data source serves `dataspace.resolveNames`, `dataspace.resolveBuilders` and `session.getFactory`, and peers on the Dataspace screen get their names.
- An `ifric` check in the health report, for which 401 and 403 are failures.
- A stub of the registry's routes under a profile of the local environment.

The registry is used as it is, by the backend only. It is not an agent tool.

## Capabilities

### New Capabilities

- `backend/ifric-registry`: Reading names, builders and factories from the registry.

### Modified Capabilities

- `backend/service-runtime`: `IFRIC_URL`, and a health check.
- `backend/local-environment`: Registry stub.
- `operator-ui/data-source`: The backend source serves names, builders and the factory.
- `deployment/kubernetes`: The registry's address.

## Impact

- `backend/`: new `app/ifric.py`, `app/api/ifric.py`, `sample_data/ifric_stub.py`; changes in `app/config.py`, `app/main.py`, `app/health.py`, `compose.yaml`, `.env.example`, `README.md`.
- `frontend/`: `src/data/sources/backend/dataspace.js`, `session.js`, `docs/data-interface.md`.
- `helm/`: `ifricUrl`, `factoryId`.
- `architecture.md`: API Layer, Configuration, Escalation flow.

## Out of Scope

- Using a builder for escalation: #28.
- Any change to the registry.
