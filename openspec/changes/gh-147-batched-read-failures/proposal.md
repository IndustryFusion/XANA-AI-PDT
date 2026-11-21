# Proposal

Issue: #147

## Why

Since #141 the Data explorer reads the entities, and the latest states of their attributes, that it needs at the same time in one request each, up to 100 entities or 20 latest states per request. Two things about failures of such a request were noted in the review of #141 (https://github.com/IndustryFusion/XANA-AI-PDT/pull/141#pullrequestreview-5992648146, notes 1 and 2):

- The request carries all its entities under the single timeout of a request (15 s). When the broker is slow, or the backend reads a refused list again one by one, the request times out and every node of that level shows the error, where each node used to fail or load on its own.
- An entity the broker refuses inside such a request is left out of the answer and shown as not found ("There is no entity …"); read alone, the explorer shows the broker's reason, for example that the ID is not a URI.

## What Changes

- When the request for several entities or latest states fails or does not answer in time, each of them is read on its own, so a level fails no node that its single read would not fail.
- An entity the answer leaves out is read on its own, so its node shows what its single read says: not found, or the broker's reason.
- One entity alone is read on its own as before; a level whose request succeeds is read in one request as before.

## Capabilities

### New Capabilities

### Modified Capabilities
- `operator-ui/data-explorer`: **Entities read together** — a failed request for several falls back to reading each on its own, and an entity left out of the answer is read on its own.

## Impact

- `frontend/src/data/sources/backend/entities.js`: the collector of reads of one task.
- No backend or API change; the endpoints for many entities and their answers stay as they are.
- On a level whose request fails, the explorer sends one request per entity, as before #141.
