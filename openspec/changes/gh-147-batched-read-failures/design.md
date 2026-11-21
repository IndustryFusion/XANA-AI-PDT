# Design

## Context

The backend data source collects the reads of entities and of latest states asked for in the same task and sends them to `POST /api/ngsi/entities-by-id` and `POST /api/ngsi/attr-status-by-id`, in requests of up to 100 entities or 20 latest states, each under the request timeout of 15 s. The backend leaves out of its answer an entity that doesn't exist and one the broker refuses (it reads a refused list again one by one and drops only the refused ID). The data source answered every ID left out as "not found", and a failed request failed all its callers.

## Goals / Non-Goals

**Goals:**
- A request for several fails no node that reading it alone would not fail, also when it doesn't answer in time.
- A node shows what its single read says, whether it was read together with others or not.

**Non-Goals:**
- Changing the backend's endpoints or their answers.
- Making the broker or the backend faster.

## Decisions

### D1: Read again on its own what a request for several did not answer

When the request for several fails, whatever the reason (an error, no answer within the timeout), each of its IDs is read on its own with the single request, under its own timeout. When it answers, each ID the answer leaves out is read on its own. Each caller gets the result of its single read: the entity or states, not found, or the broker's reason.

*Alternatives:*
- A longer timeout for requests carrying many IDs: a slow broker still fails a whole level, only later, and a refused ID still reads as not found.
- Smaller requests: fewer nodes per failure, but every failure still fails nodes a single read would have loaded, and more requests on a healthy broker.
- The backend returns the reason for each ID it leaves out: an API change on both sides for what a second single read already gives.

### D2: The single reads go out together, a few at a time

The IDs read again on their own are read at the same time, as before #141, but at most four at once: the browser sends about six at once to one host, and a read waiting in its queue would run out of its timeout before it is sent; four leave room for the page's other requests.

*Alternative:* one after another: a level of 100 entities would take up to 100 times the single read.

## Risks / Trade-offs

- A request for several that times out is followed by its single reads, so a node of such a level may wait for the timeout and its own single read. The level loads where single reads succeed, where it failed before. Once a single read gets no answer either, the backend is taken as not answering: the reads still waiting fail with it, so no node waits out one timeout after another.
- The reads again on their own share one bound of four for entities and latest states and every task, below the browser's connections to one host, so that other requests of the page are not held up by them. A failure answered for one entity (a 502 for it) is that entity's; only no answer at all (a timeout, the backend not reachable) makes the ones still waiting fail with it.
- A request refused for a malformed ID in it is read again ID by ID, since the backend refuses the whole request for one such ID; only not being signed in is passed on as it is.
- A level whose request fails sends one request per entity, as before #141, at most four at once, so that none of them waits in the browser's queue until its timeout runs out. Not being signed in, which holds for the whole request, is passed on as it is instead.
- Every entity an answer leaves out costs one more request, also one that simply doesn't exist, such as the target of a relationship to a deleted entity. A level with many such targets is read in more than one request.
