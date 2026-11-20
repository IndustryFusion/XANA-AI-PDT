# Design

## Context

- The explorer keeps each line's view state under a key built from the entity node and the attribute path: whether its sub-attributes are open, and which relationship targets are expanded in place (per instance since #137). A target expanded in place is an entity node whose key starts with the line's key, so a node's whole tree shares its key as a prefix. Raw JSON and history panes are kept per node under the time-shift moment and the node's key.
- Each entity node reads its entity and its attributes' latest states through the data layer, one request each, when it is expanded. In a tree, the same entity is reached over several relationships; only an entity already shown above in the same branch is marked instead of expanded.
- The backend reads one entity from the broker by its ID, and an entity's latest attribute states from the time series with a query per entity that sorts its rows.

## Goals / Non-Goals

**Goals:** see an entity's whole tree, and fold it back, in one click each; read a tree in a few requests; keep the broker and the time series database's load bounded however large the tree.

**Non-Goals:** a nesting-limit setting; expanding the whole result list; caching between requests.

## Decisions

### D1: Expanding all is a mode of a node's tree

*Expand all relationships* marks the node's key as being expanded. A line whose node lies in a marked tree (its key starts with the marked key, `#` and the start of a level, so that an entity whose ID merely shares the start isn't taken for it; and not inside an entity moved out of the tree), once per tree, when it first appears, opens its sub-attributes, whatever they hold, so that relationships among them are reached, and expands its own relationship targets, leaving out those shown above in its branch, those beyond the nesting limit and those moved out of the tree. Targets that load later do the same, so the tree grows level by level as it loads. The tree keeps the lines that have expanded, so a line mounting again (its node folded and opened, the operator back from another area) expands nothing anew, and a target folded by hand stays folded. Asking to expand all again starts a new generation of the tree: its lines expand once more, a nested entity folded with its own toggle opens again, and the entities already shown are not expanded twice. A node belongs to the innermost tree being expanded, so expanding all on an entity inside a tree works in its own tree; expanding all on an entity takes over the trees being expanded below it, so asking again on the outer one reaches them too.

*Alternatives:*
- Read the whole tree first, then show it: one more traversal next to the one the nodes already do, and nothing shown until all is read.
- Expand the nested nodes from the top in one pass: their relationships are only known once they are loaded.

### D2: Each entity once per tree

The tree being expanded keeps the IDs of the entities expanded in it, starting with its own, in the explorer's state, so they are forgotten when the session ends, together with those already expanded in place in it, also by hand, when expanding all starts. A line expands only targets not yet in it, and adds them. An entity reached over several relationships is thus expanded at the first place it is reached and stays a line elsewhere, which the operator can expand by hand.

*Alternative:* expand every occurrence, limited only by the branch and the nesting limit. That was measured at about 3,000 nodes for 210 entities: the same entities shown and read many times.

### D3: Collapsing all folds the kept state of the tree

*Collapse all* sets every sub-attribute list to closed and every list of targets expanded in place to empty, for the keys in the node's tree, closes the raw JSON and history panes of the node and the nodes below it, and ends expanding all there. An entity moved out of the tree is not part of it, though its key still lies under its origin; it keeps its place in its origin's list of targets, so re-nesting it shows it there again. On a node expanded in place, it also removes the node's entity from its relationship line's targets, so the relationship shows as one line again. A node at the top stays open; its own toggle folds it.

*Alternative:* fold the top node too. A complex entity that was unfolded is usually still the one being looked at, and folding it is one click on its toggle.

### D4: Reads of the same moment go together

The backend data source collects the reads of entities, and of attributes' latest states, asked for in the same task, such as the nodes of a level mounting together, and sends them to the backend's endpoint for many IDs in requests of up to 100 entities, or 20 entities' latest states (each read from the time series), so that each stays short against the request timeout; the requests of one task go out together. Each caller gets its own answer, as its single read would: an entity left out of the answer is "not found", latest states left out are none, and a failure of a request reaches each of its callers. One ID alone is read with the single request as before, so nothing changes for a single entity. Only reads of the same task go together: a read asked for later, such as after a change, is always sent anew.

*Alternatives:*
- Share any read of the same entity that is still running: a read after a save would get an answer from before the save. A first version did this; a test showed the stale answer.
- A cache with a lifetime: the same risk, and the live updates and the explicit refreshes rely on reading anew.

### D5: The backend bounds its own reads

The endpoint for many entities asks the broker for up to 100 IDs per query (`id` list), and reads an ID with a comma, which the list can't hold, on its own. When the broker refuses a list (an ID it doesn't accept, an address too long), that list's IDs are read one by one, four at once across all requests, so only the refused ID is left out, while a failing broker still fails the request. The endpoint for many latest states reads the time series for at most four entities at once, across all requests, since the frontend sends the requests of a level together; an entity the time series doesn't know or refuses is left out, while a failing or unreachable time series fails the request and stops the reads still running. Both accept up to 1,000 IDs per request and refuse more.

*Alternatives:*
- One query of the time series for all IDs: it reads and sorts every row of all of them at once, the same load as before in one statement.
- No limit on IDs per request: a request could ask for the whole broker.

## Risks / Trade-offs

- A large tree is still large: expanding all of an entity with many distinct entities shows all of them, bounded by the nesting limit. The requests stay a few per level.
- An entity expanded at its first place is not repeated elsewhere, so a relationship further down shows a line where the operator might expect the entity; it can be expanded by hand.
