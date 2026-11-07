# Proposal

Issue: #24

## Why

Operators editing data need to know the allowed values and ranges. These live in the machine ontology and SHACL shapes in the platform's Fuseki, and the mock's `getValueHints` only imitates them. The conversation agent (#29) needs the same facts. This reads a formal ontology. It is not document retrieval, and is not part of the RAG exclusion.

## What Changes

- `/api/shacl/hints` gives allowed values and ranges for the explorer, and `hint_type: none` when there are none, or Fuseki can't answer.
- Three read functions for #29: a SPARQL query, SHACL shapes for an entity type, and knowledge for an entity type. Errors come back as data.
- Entity types are escaped when placed in queries.
- Settings: `FUSEKI_URL`, `FUSEKI_DATASET`, `FUSEKI_GRAPH_BASE`.
- `getValueHints` returns allowed values and ranges, and the value editor shows both.
- Fuseki in the local environment under a profile, loaded with sample shapes and knowledge.

## Capabilities

### New Capabilities

- `backend/ontology`: Hints and read functions over the ontology.

### Modified Capabilities

- `backend/local-environment`: Optional Fuseki with sample data.
- `operator-ui/data-source`: The backend source serves `getValueHints`.
- `operator-ui/data-explorer`: The value editor shows allowed ranges.

## Impact

- `backend/`: new `agent/xana_agent/sources/ontology.py`, `app/api/shacl.py`, `sample_data/ontology/`; changes in `app/config.py`, `app/main.py`, `sample_data/`, `compose.yaml`, `agent/pyproject.toml` (the runtime dependency `rdflib`), `.env.example`, `README.md`.
- `frontend/`: `ValueEditor.jsx`, the interface, the mock's hints, backend `entities.js`, `docs/data-interface.md`.
- `helm/`: Fuseki settings.
- `architecture.md`: Data sources, Key Variable Groups.

## Out of Scope

- The agent calling the read functions: #29 does that.
- Writing to Fuseki.
- Document retrieval (RAG), as set out in #18.
- Changes to the platform's Fuseki or its authentication.
