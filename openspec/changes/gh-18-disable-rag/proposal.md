# Proposal

Issue: #18

## Why

Document retrieval is not part of the current work. The operator UI still offers a Knowledge Base screen, and mock runs show a document retrieval step. A backend build falls through to mock documents, so operators would see documents that do not exist. `architecture.md` also describes retrieval as part of the running system, along with some registry details that do not hold.

## What Changes

- Turn the knowledge base off by default, through one setting, keeping its code and specification so it can return.
- Stop mock runs showing document retrieval while it is off, so runs look the same on the mock and backend data sources.
- Keep backend builds from falling through to mock documents.
- Update tests and frontend documentation to match.
- Mark retrieval in `architecture.md` as not part of the current system, and correct the registry details.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `operator-ui/knowledge-base`: Off by default, and its other requirements apply only when it is switched on.
- `operator-ui/data-source`: The documented data interface and the backend source treat the knowledge base as an optional area.
- `operator-ui/run-simulation`: Mock runs show no document retrieval while the knowledge base is off.

## Impact

- `frontend/`: System area, data interface, mock data source and backend source, tests, `docs/data-interface.md` and `README.md`.
- `architecture.md`: System Overview diagram, Agent Runtime, Knowledge Base, Deployment Architecture, the System row in the frontend table, and the escalation flow's registry lookup.
- No backend code changes, as the backend has no retrieval code.

## Out of Scope

- Any retrieval service, ingestion, embedding or vector store work.
- Deleting the knowledge base screen, its mock data or its specification.
- Similar-incident lookup from agent memory, the `documents` data-sharing category, and ontology queries (#24). These are not document retrieval and are unchanged.
