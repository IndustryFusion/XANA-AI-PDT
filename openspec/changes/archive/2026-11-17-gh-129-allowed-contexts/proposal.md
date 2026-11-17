# Proposal

Issue: #129

## Why

The import refuses any context but the ETSI core context and the configured one, as the context broker fetches a named context itself, from inside the platform; others can be allowed only through `NGSI_ALLOWED_CONTEXTS` at deployment. So the IFF platform's own documents, such as the OPC UA instance tool's output with `https://industryfusion.github.io/contexts/staging/opcua/v0.2/context.jsonld`, can't be imported without changing the deployment, and the refusal neither names the context nor says where to allow it (#129).

## What Changes

- **Allowed contexts:** the ETSI core context, a built-in list maintained in the backend (the IFF contexts on `https://industryfusion.github.io/contexts/`), the deployment's, and those added in the System area, kept in the memory database. An entry ending in `/` allows every context below it.
- **Routes:** `GET /api/ngsi/contexts` lists them with their source; `POST` adds one, `DELETE` removes one added; `GET /api/ngsi/contexts/risks` names what allowing an address risks (plain http, an address inside the network, a host that can't be resolved).
- **The refusal** names the refused context unless its address looks internal, and points to the System area.
- **System area:** a card *Allowed contexts* lists them, adds one after a dialog that states the risk, and removes one added there.
- **Data source:** `listAllowedContexts`, `checkContext`, `allowContext`, `removeAllowedContext`.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `backend/explorer-api`: *Import* (the scenario *Context that isn't allowed*, and two new ones on naming the context); new *Allowed contexts*, *Allowing a context*.
- `operator-ui/system-health`: new *Allowed contexts*.
- `operator-ui/data-source`: new *Allowed contexts from the backend*.

## Out of Scope

- A role that may add contexts: any signed-in user can, after the warning.
- Fetching contexts in the backend and inlining them, so the broker never fetches.
- Contexts named in a fetched context itself.

## Impact

Backend: a new `app/ngsi/contexts.py`, a migration for the table `allowed_contexts`, `app/ngsi/broker.py`, `app/api/ngsi.py`, `app/main.py`, and their tests. Frontend: a new card in the System area, the data interface and both sources, the interface documentation and recorded backend answers, and their tests.
