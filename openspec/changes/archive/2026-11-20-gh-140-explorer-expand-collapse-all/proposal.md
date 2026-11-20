# Proposal

Issue: #140

## Why

The Data explorer expands relationship targets in place and opens sub-attribute lists one at a time. Seeing an OPC UA machine's whole tree takes many clicks, and folding it back as many (#140).

Expanding many entities at once also shows that the explorer reads each entity on its own: every expanded node asks the backend for the entity and for the latest state of its attributes, and an entity reached over several relationships is shown and read at each place. For an OPC UA machine with about 210 entities, expanding all levels ended with about 3,000 nodes and about 6,000 requests within a minute, more than the broker and the time series database behind the backend could keep up with.

## What Changes

- Every entity in the explorer, at the top or expanded in place, offers **Expand all relationships**: every relationship target below it is expanded in place as the levels load, including relationships in sub-attributes, and each entity once in that tree. A target folded by hand stays folded.
- Every entity offers **Collapse all**: sub-attributes, targets expanded in place, raw JSON and history panes below it are folded; an entity expanded in place is also folded back into its relationship's line.
- The explorer reads the entities, and their attributes' latest states, that it needs at the same time together: one request for many entities instead of one each. A single entity is read as before.
- The backend gives many entities, and many entities' latest attribute states, in one request each: it reads the broker for up to 100 entities per query, and the time series for at most four entities at once.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `operator-ui/data-explorer`: new *Expand and collapse all* and *Entities read together*.
- `backend/explorer-api`: new *Many entities at once*.

## Out of Scope

- A setting for the nesting limit, which stays as it is.
- Expanding all entities of the result list at once; the actions work per entity.
- Caching entities between requests: what is read is always read anew.
- Other areas than the Data explorer.

## Impact

Frontend: the explorer's entity header, attribute lines and kept state, the backend data source's reads of entities and attribute states, two icons; backend: two routes of the explorer API, the broker client and the time series reader; their unit and end-to-end tests. Affected section of architecture.md: none; the *Frontend* table's Data explorer row and the backend's explorer operations already cover what changes.
