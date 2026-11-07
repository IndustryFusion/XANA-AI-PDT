# Design

## Context

The backend sends a query to the context broker when the broker can evaluate it, and otherwise reads up to `MAX_SCANNED` entities and evaluates the expression itself (`backend/explorer-api`, "Query and browse"). Import uses the broker's batch upsert with `options=update`, which merges. The NGSI-LD API offers `offset`, `count=true` (the `NGSILD-Results-Count` header), `attrs`, and an upsert without `options`, which replaces. There is no conflict with `architecture.md` or the specs, apart from the "New and existing entities" scenario of "Import", which this change replaces as the issue asks.

## Decisions

### Paging

`offset` is a whole number from 0, and `limit` stays 1 to 1000. When the broker evaluates the query, both go to it with `count=true`, and the answer carries the total in an `X-Total-Count` header, so the body stays a list. When the backend evaluates the expression itself, the offset applies to the matches, and the total is given only when the whole set was read; otherwise the existing `X-Results-Limited` header says how far it got.

The explorer keeps `offset` in the URL with the rest of the query, and offers next and previous. Next is offered while the total says there is more, or, without a total, while a page came back full.

Alternative: cursor-based paging. The broker pages by offset, and an offset in the URL can be shared.

### Attributes to return

`attrs` is a comma-separated list of attribute names, written as in a query expression: a full IRI, or a term of the configured context. It goes to the broker as `attrs`, and what the broker returns is the answer: only those attributes, and only entities that have at least one of them. When the backend evaluates the expression itself, it matches on whole entities and then keeps only the named attributes, so the answer is the same as the broker's for the same query.

### Has attribute

`has_attr` names one attribute. Only entities that have it are returned, whole. The backend asks the broker with `attrs=<name>` to find them, as the broker's own answer to that query, and then reads those entities whole, by ID, in one request per page. Combined with `attrs`, the answer is the entities that have the attribute, with the selected attributes.

Alternatives considered:

| Option | Why not |
|---|---|
| An existence term in `q` | The broker's support for a bare attribute name in `q` can't be relied on, and the backend's own evaluation would then read up to `MAX_SCANNED` entities |
| Return the projection only | The issue separates "has attribute" from choosing attributes |

### Import replaces

The upsert is sent without `options=update`, so the broker replaces an existing entity. Results stay `created` or `updated`, with `updated` meaning replaced. The type check before sending stays, so an entity of another type with the same ID is still refused. The import dialog says, before confirming, that existing entities are replaced and attributes not in the file are removed.

Alternative: offer merge and replace. The issue asks for replace; one behaviour keeps the import result unambiguous.

## Risks

- A replacing import removes attributes written by devices or other tools that are not in the file. The dialog says so before the operator confirms.
- Paging by offset can skip or repeat entities when the twin changes between pages; the broker has no snapshot to page through.
