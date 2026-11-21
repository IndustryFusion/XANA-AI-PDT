# Proposal

Issue: #149

## Why

The broker client builds the same chunked id-list query (`GET /entities?id=a,b,…`) in three places in `backend/app/ngsi/broker.py`: the second read of the has-attribute filter, `entities_by_id` (added in #141) and the read of existing types before an import. They differ: only `entities_by_id` reads an ID with a comma on its own and falls back to single reads when the broker refuses a list; the other two send a comma ID inside the list, where the broker splits it, and fail as a whole on a refused list. There are two constants for the same chunk size, and the bounded concurrent read is written twice, in `broker.py` and `history.py`. Noted in the reviews of #141: https://github.com/IndustryFusion/XANA-AI-PDT/pull/141#pullrequestreview-5991942868 (note 3) and https://github.com/IndustryFusion/XANA-AI-PDT/pull/141#pullrequestreview-5992648146 (note 5).

## What Changes

- One helper reads the entities of a list of IDs for all three places, in queries of 100 IDs, an ID with a comma and the IDs of a list too long for the broker's address on their own; for the endpoints for many entities and the import also the IDs of a list the broker refuses; a failing broker fails the read.
- The import therefore tells an existing entity with a comma in its ID, or of a list the broker refuses, as updated, and is refused rather than written when the broker refuses to read an ID; the has-attribute filter returns an entity with a comma in its ID, or of a list too long for the address, whole, and stays refused when the broker refuses its list or its attributes.
- One helper runs bounded concurrent reads, for the broker's single reads and the time series.

## Capabilities

### New Capabilities

### Modified Capabilities
- `backend/explorer-api`: new requirement **Entities read by a list of IDs**, the rules every read by a list of IDs follows.

## Out of Scope

- The endpoints' answers and the bounds on IDs (#148).
- The batch size of the import's upsert (`BATCH`), which is not a read.
- Frontend changes.

## Impact

- `backend/app/ngsi/broker.py`: `_by_ids` replaces the three loops; one constant `IDS_PER_QUERY`.
- `backend/app/ngsi/bounded.py` (new): `gather_bounded`, used by `broker.py` and `history.py`.
- Affected section of architecture.md: none; the backend's reading of the broker is described there without these details.
