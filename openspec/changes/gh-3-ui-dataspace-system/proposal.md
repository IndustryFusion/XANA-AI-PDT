# Proposal

Issue: #3

## Why

Escalation to machine builders and policy-gated data sharing depend on the IFF Dataspace connection and on what each peer may access; diagnoses depend on healthy data sources and a knowledge base of manuals and procedures. Operators currently cannot see or manage any of this. This change delivers the Dataspace and System areas, completing the operator UI of issue #3. It is the last of four changes.

## What Changes

- **Dataspace** area:
  - connection state, session validity and own participant and factory identity; connect (with a credential when the configuration does not provide one) and disconnect;
  - compatible peers with the capabilities each side may access;
  - incoming capability requests with approve and deny;
  - per-peer policy changes;
  - the configured data-sharing tier (`minimal`, `adjacent`, `timeseries`) explained in plain words with what each tier sends.
- **System** area:
  - connectivity of every dependency with status, latency, detail and time of check, plus overall health;
  - service settings (addresses of the context broker, time-series store, message broker and alert manager) and session state;
  - **knowledge base**: documents per ingestion pipeline, upload by drop or file picker with progress until done or failed, edit description, delete, and a test query showing ranked passages with their source.
- Mock implementations of the remaining `dataspace`, `knowledgeBase` and `system` operations of the UI data interface.

## Capabilities

### New Capabilities

- `operator-ui/dataspace`: Managing the dataspace connection, peers, capability requests and policies, and understanding the data-sharing tier.
- `operator-ui/system-health`: Dependency health, service settings and session state.
- `operator-ui/knowledge-base`: Managing the documents the agent retrieves from, and testing retrieval.

### Modified Capabilities

None.

## Impact

- Code: `frontend/src/features/dataspace/`, `frontend/src/features/system/`, mock data source (`dataspace`, `knowledgeBase`, `system`).
- UI data interface: implements the documented operations; no operation is added or renamed.
- Dependencies: none added.
- `architecture.md` sections affected: none. Components → Frontend already describes both areas; the data-sharing tiers follow **Policy-gated data sharing**.

## Out of Scope

- Backend, backend adapter, real gateway, registry, knowledge-base services.
- Changing the configured data-sharing tier from the UI (it is deployment configuration per `architecture.md`).
- Managing users, roles or identity-provider settings.
- Editing document contents or chunking parameters.
