# Design

## Context

`architecture.md` lists the Data Explorer and its data sources. The explorer's screens and the `entities` interface exist and run on the mock. The backend talks to Scorpio only with GET requests, from the agent. Nothing reads PostgREST yet.

## Goals / Non-Goals

**Goals:**

- Every explorer operation in `frontend/docs/data-interface.md` works on `VITE_DATA_SOURCE=backend`, except live updates and hints.
- Behaviour was checked against real Scorpio and PostgREST, and against the platform's table layout.

**Non-Goals:**

- Letting the agent edit anything.
- Changing the shared session, which is the current decision (see #36).

## Findings: what was checked first

Checked against the digital twin's charts and code, and a real Scorpio (6.0.2 all-in-one image) and PostgREST (v12.0.0, the platform's version).

| Question | Finding | Consequence |
|---|---|---|
| `attributes` layout | `id`, `parentId`, `observedAt`, `modifiedAt`, `entityId`, `attributeId` (full IRI), `attributeType`, `datasetId` (never null, `@none` when absent), `nodeType`, `value` (text, null when deleted), `valueType`, `unitCode`, `lang`, `deleted` (nullable). `id` is `<entity>\<hash>`, and is unique per attribute and dataset. Sub-attributes point to their parent through `parentId`. | The sample table moves to this layout. Reconstruction goes by `id` and `parentId`. |
| `entities` layout | `id`, `observedAt`, `modifiedAt`, `type`, `deleted` (nullable). | Time-shift uses it for what existed at a moment. |
| `deleted` | Nullable in both tables. The agent's `NOT "deleted"` drops rows where it is null. | Reads use "is not true". |
| Table names | Platform defaults are `attributes` and `entities`, set in its values. | `TIMESCALE_TABLE` stays, `TIMESCALE_ENTITY_TABLE` is added. |
| PostgREST auth | No anonymous role. JWT checked against Keycloak's keys, and the role comes from the `role` claim, which the `pgrest_role` client scope hard-codes to the reader user. The `scorpio` client has that scope, so the operator's token works. | Requests carry the operator's bearer token. Without one the platform's PostgREST answers 401, which is shown as such. |
| PostgREST filters | `eq.`, `in.`, `lte.`, `gte.`, `or`, `order`, `limit`, `select` on the platform's quoted camelCase columns all work. Values in `in.()` and `or=()` must be double-quoted, or a comma in a value changes the filter. | Values are always quoted and escaped. Attribute names are never joined in unquoted. |
| Scorpio attribute names | Platform attributes are full IRIs, and answers keep them. A short name in `q` without a context expands to the default context and **silently matches nothing** on such data. With a `Link` context that maps the term, it matches. | `NGSI_CONTEXT_URL` adds a `Link` header. It also fixes the agent's inverse relationship queries, which otherwise find nothing on platform data. |
| Operators in `q` | `~=` and `!~=` answer 400 (a jsonpath syntax error), and ranges too. `!attr` answers 500. `==`, `!=`, `>`, `>=`, `<`, `<=`, lists, `attr`, `attr.sub`, `attr[key]`, `;`, `|` and parentheses work. | See decision 3. |
| Remote contexts | An entity's `@context` URL is fetched by Scorpio from inside the cluster, and the failure's reason quotes the address. | See decision 11. |
| IRIs in `q` | A full IRI with a dot in its host (`https://industry-fusion.com/...`) **silently matches nothing**, because `.` separates sub-attributes in a `q` path. IRIs without a dot work. | The UI's query builder offers the broker's names. See decision 3. |
| Bad `q` | Scorpio answers 500 with an internal error for `((`. | The backend checks the syntax first and answers `invalid`, with the position. |
| Partial attribute update | `PATCH .../attrs/{name}` **replaces** the attribute, losing `unitCode` and sub-attributes, and answers 204 for an attribute that does not exist. `PATCH /entities/{id}` merges, but needs `type` in each fragment. | See decision 2. |
| Sub-attribute delete | `DELETE .../attrs/{name}/{sub}` answers 405. Overwriting the attribute with `POST .../attrs` removes it. | See decision 2. |
| Attribute delete | Answers 204 for an attribute that does not exist, and 404 for one with several datasets unless `deleteAll=true`. | Existence is checked first, and `deleteAll=true` is sent. |
| `noOverwrite` append | Answers 204 even when it skipped an existing attribute. | Existence is checked first, to answer `conflict`. |
| Upsert | 201 with created IDs, 204 if all were updated, 207 where `success` mixes created and updated. An `@context` needs `application/ld+json`, and then every entity must have one. | Existing IDs are read first to tell created from updated. Entities with and without `@context` go in separate requests. |
| Counting | `count=true&limit=0` reports 0. `limit=1` reports the right count. | `stats` uses `limit=1`. |
| Query criteria | `idPattern` alone is refused. `type=*` is accepted. | `type=*` is added when only an ID pattern is given. |
| Limit | Over 1000 answers 403. | The route checks 1 to 1000 itself. |

## Decisions

### 1. Own configuration only

Routes take no address, header or token from the caller. Scorpio is `NGSI_URL`, PostgREST is `PGREST_URL`, and the bearer token is the session's. A path segment from a caller is always percent-encoded, and a filter value is always a parameter.

**Alternative:** let the UI's service settings choose addresses. Rejected: any caller could then send the operator's token anywhere.

### 2. Editing keeps what the operator didn't change

- **Update:** read the entity, refuse a missing attribute as `not_found`, then `PATCH /entities/{id}` with the existing `type` in each fragment, stamping `observedAt` when a value changes and the fragment doesn't set it. Text for a numeric value is refused as `invalid`. An attribute with several datasets is overwritten through `POST .../attrs`, which keeps its other datasets.
- **Sub-attribute delete:** read, remove, then overwrite through `POST .../attrs`.

The backend makes these read-then-write steps one at a time per entity, so two adds of one attribute give one success and one `conflict`, where the broker would answer 204 to both and drop a value. Another writer, or a second backend process, can still change an attribute between the read and the write, and that change can be lost. There is one process per deployment while the session is per process (#36). **Alternative:** `PATCH .../attrs/{name}`. Rejected: it loses units and sub-attributes.

### 3. A `q` that Scorpio can't evaluate

The backend has its own parser for the documented `q` grammar, needed for syntax errors and time-shift. It evaluates an expression itself when it holds `~=`, `!~=`, `!attr`, a range, or an IRI with a dot, as Scorpio refuses, fails on or silently misses those. It does the same if Scorpio fails on any other expression that passed the syntax check. It reads up to 5000 entities for the query's type, and returns the first `limit` matches.

**When it stops early,** the answer has a header `X-Results-Limited: scanned=5000, total=5300`, as the body stays what the broker's would be. The data source gives the list a `limited` member, and the Data Explorer says so, also when nothing matched.

These were measured on Scorpio 6.0.2, as the platform's own image isn't available. If the platform's accepts more, the backend still answers correctly, just more slowly.

**Alternatives:** pass everything through (refused or silently wrong), or register a generated context in the broker for each query (leaves contexts behind, and covers only IRIs).

**Patterns run on RE2** (`google-re2`), as Python's `re` let `(a+)+$` on 28 characters hold up the whole backend for 29 seconds. RE2's time is linear in the text, so no worker or timeout is needed. It has no look-around or back-references, which are refused as `invalid`. **Alternatives:** the `regex` package with a timeout still blocks the event loop for that time; a thread can't be stopped; a worker process is more to run and fail.

### 4. History through PostgREST

`history` selects by entity and attribute, in a time range, oldest first, up to 5000 rows. A name without a scheme also matches IRIs ending in `/name` or `#name`, so short names work on the sample data. Top-level rows only (`parentId` is null), unless the name is a sub-attribute's. `deleted = true` rows are left out; `attr-status` reports them. Numbers come back as numbers, unless `valueType` says string, and relationships stay text.

`getAttributeHistory`'s `not_found` is not produced: the store can't tell an unknown entity from one with no rows, so the answer is an empty list.

A short name is matched with `like`, so `%` and `_` in it are escaped, and `*` is refused. When a range holds more rows than fit, the answer has the same header, `newest=5000`, and the history says so.

### 5. Time-shift reconstructs from rows

1. Read `entities` up to the moment, latest row per ID, keeping those not deleted. Page through up to 100000 rows.
2. For each candidate, read the latest row per attribute: `order=id.asc,observedAt.desc`, then continue past the last `id` seen, so a signal with thousands of rows costs one request, not thousands.
3. Leave out deleted rows and children of deleted rows. Rebuild kinds from `attributeType` and `nodeType`, sub-attributes from `parentId`, and several datasets as a list.
4. Apply `id`, `idPattern` and `q` with the backend's parser, up to `limit` matches.

**Alternative:** a database function: the platform's reader has no such function, and the platform must not change. **Limit:** `entities.observedAt` is the time the platform recorded the change.

### 6. Import from a URL refuses internal addresses

http and https only, with no user name or password in the URL. Every address the host resolves to must be public (`is_global`; IPv4-mapped IPv6 is unwrapped). The connection goes to the checked address, with the original host name for `Host` and TLS, so a second DNS answer can't redirect it. Redirects are followed by hand, up to 3, each checked again. Environment proxies are ignored. 10 MB and 10 s at most; the answer must be JSON. A refusal is `invalid` and doesn't say what the host resolved to.

**Alternative:** a host allow-list setting: safer, but needs configuring before any use. It can be added later.

### 7. Errors

`unavailable` keeps its 503 for the backend's own state. For a service behind the backend, not reachable, 5xx or nonsense, it answers **502**. The message names the service and the status, never an address, token or body. Scorpio's 400 becomes `invalid` with its `detail`, 404 `not_found`, 409 `conflict`, and 401/403 `unauthorized`, with a message saying who refused. This extends `backend/run-api`'s error kinds, so that requirement is modified.

### 8. Keys are not mapped

The backend source maps snake_case keys to camelCase, which would alter attribute names such as `max_temp`. The explorer's answers skip that mapping.

### 9. Sample tables move to the platform's layout

`attributes.sql` gains the platform's columns, using `ADD COLUMN IF NOT EXISTS` so existing volumes keep working, and adds `entities`. Tests use the same layout, and a test keeps the old one working for the agent's queries.

### 10. Agent history

Two reads are added to the history source: non-numeric changes (`changes`), and entity lifecycle (`lifecycle`). Observe calls them separately from `recent`, and a failure leaves the rest of the round unchanged. An external program's history source that doesn't offer them is treated as having none. All go through the read-only transaction that the source already uses.

### 11. Remote contexts

Scorpio fetches an entity's `@context` from inside the cluster, so an import is another way of reaching internal addresses, past the checks of decision 6. **Only these may reach the broker:** the ETSI core context, `NGSI_CONTEXT_URL`, the addresses in `NGSI_ALLOWED_CONTEXTS`, and inline contexts with no `@import` or nested `@context`. Anything else fails that entity, whatever its source. A `@context` inside an attribute is refused on import and on edits. Addresses are taken out of the reasons the broker gives.

**Alternatives:**
- Apply decision 6's check to the context's address: Scorpio makes the connection, so a second DNS answer or a redirect would get past it.
- Refuse every `@context`: real documents name the core context.
- Strip it: the same terms would then mean something else.

**Limit:** a platform that imports documents naming its own contexts must list them.

### 12. What isn't in the health report

PostgREST, Alerta, Fuseki and EMQX aren't in `/api/diagnostics`. The `backend/service-runtime` spec lists four dependencies, and a local environment without the optional profiles would show as degraded. A decision for maintainers. Each area shows its own failures.

## Risks and limits

- **Open API, with edits now.** While the shared session stands, anyone who can reach the backend can edit, delete and import with the signed-in operator's token. This widens the limit recorded in `gh-21-keycloak-sign-in`. It is the user's decision for now, and #36 is the redesign. Limit network access.
- **Reference version.** The platform's chart names `ibn/scorpio-all-in-one-runner`, whose image was not available here. Behaviour above is from the public 6.0.2 image.
- **Full platform not run.** Rows were written to the platform's table layout directly, not through its bridges.
