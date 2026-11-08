# Proposal

Issue: #53

## Why

The Data explorer shows only the first page of a query, always returns whole entities, can't ask which entities have an attribute, and an import merges into an existing entity, so an attribute removed from the file stays in the twin.

## What Changes

- **Paging.** The entities query takes `offset` as well as `limit`, and reports the total when the context broker gives it. The Data explorer pages forwards and backwards through the results, with the page in the URL.
- **Attributes to return.** The query takes a list of attribute names; the answer holds only those attributes, as the context broker's `attrs` gives them.
- **Has-attribute filter.** The query takes an attribute name; only entities that have it are returned, and each is returned whole. The explorer offers it as a "Has attribute" filter next to the query builder.
- **Import replaces.** Importing an entity that already exists replaces it, so attributes no longer in the file are removed. The import preview and result say that import replaces. URL import still refuses internal addresses.
- The mock source behaves the same, and `docs/data-interface.md` documents the new parameters.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `backend/explorer-api`: Offset and total, attribute selection, has-attribute filter; import replaces.
- `operator-ui/data-explorer`: Paging, attribute selection, "Has attribute" filter, import says it replaces.

## Impact

- `backend/`: `app/api/ngsi.py`, `app/ngsi/broker.py`, tests.
- `frontend/`: `src/features/explorer/` (query bar, query state, result list, import dialog), both data sources, `docs/data-interface.md`, tests.
- `architecture.md`: the `/api/ngsi/entities` row of the API table.

## Out of Scope

- Paging and attribute selection for the twin at a past moment (time shift), which reads the time-series store: it keeps its limit.
- An undo for a replacing import, or a merging import as an option.
- Changing how URL import fetches or which addresses it refuses.
