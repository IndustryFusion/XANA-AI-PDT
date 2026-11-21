# Design

## Context

Reading entities by a list of IDs is done in three places of the broker client, each with its own loop over chunks of 100 IDs; only `entities_by_id` handles an ID with a comma (which the broker's `id` list splits) and a list the broker refuses (an ID it doesn't accept, an address too long). The bounded concurrent read with a shared semaphore and a task group that stops on the first refusal is written in `entities_by_id` and in `AttributeHistory.statuses`.

No conflict with architecture.md or existing specs: the new requirement states for every read by a list of IDs what *Many entities at once* already requires of the endpoints for many entities, and the import and the has-attribute filter keep their answers for IDs without a comma.

## Goals / Non-Goals

**Goals:**
- One implementation of the read by a list of IDs and one of the bounded concurrent read, so that a fix applies everywhere.
- The same handling of comma IDs and refused lists in every read by a list.

**Non-Goals:**
- Changing what the endpoints answer for ordinary IDs.

## Decisions

### D1: `_by_ids` with parameters

`_by_ids(ids, params)` reads the entities of `ids` that exist, by ID, in id-list queries of `IDS_PER_QUERY` (100) IDs with `params` added (the has-attribute filter's `type` and `attrs`). An ID with a comma, and every ID of a list too long for the address, is read on its own with the same attributes, and a single read that holds none of the selected attributes is left out, as the list query leaves it out; at most `SINGLE_READS` of those reads run at once. The import's read of existing types leaves out only IDs the broker doesn't know (`leave_out_refused=False`), so that an ID it refuses fails the import instead of being written as new. A failing broker fails the read, and so does an answer to a single read that is no entity. Without further parameters (the endpoints for many entities, the import), the IDs of a list the broker refuses as invalid are read one by one too, and an ID it refuses on its own is left out. With parameters (the has-attribute filter's `type` and `attrs`), a refusal can't be told from one of the parameters, so only a list too long for the address (414) is read one by one, and any other refusal reaches the caller as it is: attributes the broker refuses stay a 422 after one query, as on `main`. `entities_by_id`, the has-attribute filter's second read and the import's read of existing types call it.

*Alternatives:*
- Keep the three loops and copy the comma and refusal handling into the other two: three places to keep in step, which is how they diverged.
- With parameters, read a refused list one by one and pass the refusal on only when every ID is refused alike: a guess at the cause that answers an empty list for comma IDs, costs a read per ID for refused attributes, and fails a lone refused ID.

### D2: `gather_bounded`

`gather_bounded(gate, items, read)` runs `read` for every item, at most as many at once as the shared semaphore lets through, and stops the reads still running on the first refusal, which it raises as it is. The broker's single reads and the time-series reads of `statuses` use it, each with its own app-wide semaphore.

*Alternative:* `asyncio.gather` with the semaphore at each call site: the stop on the first refusal would have to be written at each again.

## Risks / Trade-offs

- An import with a list the broker refuses, and a has-attribute query with a list too long for the address, now cost one read per ID of that list, where they failed before.
