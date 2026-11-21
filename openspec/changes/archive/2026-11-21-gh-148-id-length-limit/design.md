# Design

## Context

Both endpoints for many entities take their IDs through the Pydantic model `EntityIds`, which already bounds their number (1,000); FastAPI answers a model that doesn't validate with 422 before the handler runs. Entity IDs are URIs; on a platform with a large OPC UA model the longest of a few hundred sampled entity IDs had 113 characters.

No conflict with architecture.md or existing specs: the bound narrows only the endpoints for many entities of *Many entities at once*, and the explorer already reads each ID on its own when such a request is refused (*Entities read together*).

## Goals / Non-Goals

**Goals:**
- Refuse an ID that no entity of the platform can have before it reaches the broker or the time series.

**Non-Goals:**
- Checking that an ID is a URI; the broker refuses those, and a read of many reads a refused list again one by one.
- Bounding IDs elsewhere in the API.

## Decisions

### D1: A length bound in the model of the IDs

Each ID of `EntityIds` is a string of at most 2,048 characters (`MAX_ID_LENGTH`), checked by Pydantic like the number of IDs. A request with a longer ID is refused as a whole with 422, as one with too many IDs is.

*Alternatives:*
- Leave out an ID that is too long and answer the others: the request would claim an answer for IDs it never asked about, and no entity can have such an ID anyway.
- A smaller bound close to the IDs seen: 2,048 leaves room for long IRIs of other models, and stays the usual bound of a URL.

## Risks / Trade-offs

- A request for many with one ID that is too long fails as a whole. The explorer then reads each ID on its own (#147), so only the entity with that ID can fail.
