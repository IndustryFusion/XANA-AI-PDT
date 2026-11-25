# Design

## Context

The broker answers which entities an entity points to, as they are in the entity. It has no operation for the reverse. The explorer already expands relationship targets in place, keyed by the line they hang from, and opens an entity at an attribute path (`focus`).

There is no conflict with architecture.md or existing specs. *Expand and collapse all* stays as it is; the list of referring entities is not a relationship line, so expanding all does not enter it, and collapsing all closes it.

## Decisions

### D1: The backend reads the entities and searches them

It pages through all entities in ID order, 1,000 at a time, keeping only what refers, up to 20,000 entities or until a page brings the matches to 1,000 or more. If there were more entities it says how many were searched, in the header the query already uses (`X-Results-Limited`). At most two such searches run at once, as the broker serves everyone; the interface asks for no more at once, and a search whose client is gone stops.

The cost grows with the number of entities, not with the history, and the operator asks for each search.

A name is exact: the ID is compared as a whole, never as a prefix.

Alternatives:
- *A `q` expression over the relationship names.* The broker splits a name at every dot, so it silently finds nothing for an attribute named by an IRI with a dot (as *Name the broker cannot match* already handles), and its list of attributes has no sub-attributes. An OPC UA model's names are all of that kind.
- *The time series.* Its `attributes` table holds every relationship value, also of sub-attributes, but has no index on the value, so the read grows with the whole history; and a relationship not recorded there would be missing.
- *The search in the frontend.* It would send every entity to the browser.
- *An index of references kept by the backend.* It would answer at once, but has to follow every change, and the broker notifies changes, not deletions. It can replace the search later behind the same endpoint.

### D2: What counts as a reference

A relationship's `object` (one or several) and `objectList`, and a property's `value` that is the ID, as text or as an IRI object, also one of several. The screen shows such a property as a link too. JSON, list, language, vocabulary and geo values hold data of their own kind and are not searched; a GeoProperty's value is an object without an IRI.

Alternative: relationships only. Entities that name another by an IRI-valued property would be missed.

### D3: The list is part of the entity's node

It is shown above the attributes, set apart from them, and opened by an icon in the header. A referring entity is expanded by the same node as a relationship target, so it has its own list and the way up goes on, up to the nesting limit; an entity shown above in the branch is marked. Its key continues the node's key at a level no attribute can have, so unnesting and collapsing all work as for a line, and the tree of expanding all excludes what lies beyond such a level.

The link on an attribute opens the referring entity at that attribute, as alerts do.

Alternatives:
- *A page of its own.* It would lose the tree the operator is in.
- *A query result list.* It would replace the operator's query.
- *Listing referring entities as if they were attributes.* They would be mistaken for data of the entity.

## Risks

- **Entities change while the pages are read.** A change between two pages can hide or repeat an entity, as in any paged read here; reading again answers it.
- **A long search.** The interface waits up to a minute for this operation instead of the usual time.
