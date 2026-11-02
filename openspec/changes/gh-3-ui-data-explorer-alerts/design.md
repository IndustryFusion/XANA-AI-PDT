# Design

## Context

See proposal.md → Why. Builds on `gh-3-ui-foundation` (shell, data layer, components) and `gh-3-ui-incident-workflow` (new-incident form with prefill, incident filters). The UI data interface documents all `entities` and `alerts` operations; the mock implements only `getStats` and `countAlerts` so far. The mock seed already contains a factory, lines, machines, components and sensors as NGSI-LD entities, and sixteen alerts referencing machines.

## Goals / Non-Goals

**Goals:**
- Both areas fully usable on mock data, including history, time-shift and live updates.
- Attribute rendering that handles every NGSI-LD attribute kind, so real broker data needs no UI change.

**Non-Goals:**
- JSON-LD expansion and compaction with remote `@context` documents in the browser; the data source returns compacted terms and full IRIs as they are.
- Large-volume performance work (virtualised lists); the limit field bounds result size.

## Decisions

### 1. URL as the query state
Explorer query (type, id, pattern, filters, limit, time-shift moment) and alert filters live in the URL query string; components read them through the router. Back/forward and sharing a link reproduce the view.
*Alternatives:* local component state loses the query on reload and cannot be shared.

### 2. Attribute rendering by kind
One `AttributeRow` dispatches on the NGSI-LD kind (`Property`, `Relationship`, `GeoProperty`, `JsonProperty`, `LanguageProperty`, `ListProperty`, `VocabularyProperty`, and IRI-valued properties) with a generic fallback. Sub-attributes render recursively; metadata (`observedAt`, `unitCode`, `datasetId`) is shown compactly. Relationship and IRI values use the shared `EntityRef` from the foundation, extended with "copy".
*Alternatives:* a JSON tree viewer would be simpler but hides the semantics operators need.

### 3. Query builder
Rows of attribute–operator–value conditions combined with AND or OR, rendered to an NGSI-LD `q` expression shown read-only below the builder; the expression is what the data source receives.
*Alternatives:* free-text `q` only is error-prone for operators; a builder only, without showing the expression, makes results hard to explain.

### 4. Charting library: Recharts
Attribute history uses Recharts (line chart with time axis, tooltip, unit label). The table alongside the chart satisfies the chart-alternative requirement.
*Alternatives:* hand-written SVG avoids a dependency but needs axes, scales and tooltips written and tested from scratch; canvas libraries are harder to make accessible.

### 5. Mock entities, history and live updates
- Seed extended with more attribute kinds (geo location of the factory, JSON configuration, language-tagged names, lists, vocabulary values) and per-sensor history series (deterministic, 7 days at 5-minute resolution, generated on demand from the seed rather than stored).
- Writes update the mock store; deletions are recorded with time so time-shift can rebuild earlier states (entities created after the moment are hidden, deleted ones shown, values taken from history where available).
- `subscribeEntities` emits sensor value updates every few seconds (scaled by the playback speed control from change 2) and stops when unsubscribed; failure injection for `entities` turns live-update health to unavailable.
- Import accepts arrays of NGSI-LD entities; `fetchImportDocument` in the mock serves a few built-in sample documents by URL and rejects others as unavailable, since the mock makes no network requests.
*Alternatives:* storing full history in sessionStorage would exceed its size limit.

### 6. Alerts in the mock
Seed alerts gain history entries; actions append to history and change status; `listAlerts` filters and sorts server-side (severity rank, then time); a background timer occasionally raises a new alert while the Alerts area is open in development, so refresh can be seen.
*Alternatives:* client-side filtering of a full list would not match how a backend adapter pages results.

### 7. Bulk actions
Bulk actions call `applyAlertAction` once per alert in parallel and report per alert, because the interface has no bulk operation; partial failures keep those alerts selected.
*Alternatives:* adding a bulk operation to the interface was not needed for this volume.

## Conflicts with `architecture.md` and existing specs

- None. `architecture.md` lists Alerta as the alert source and Scorpio/TimescaleDB for context and history; this change uses them only through the UI data interface.
- Extends the foundation's entity reference with a "copy" action; the foundation's app-shell scenarios remain valid.

## Risks / Trade-offs

- [Recharts adds bundle size] → Loaded only by the explorer route through a dynamic import.
- [Time-shift in the mock is an approximation] → Documented in `data-interface.md`; the UI only depends on the operation's result shape.
- [Rich attribute kinds are rare in the seed] → The seed includes at least one entity per kind, and component tests cover each renderer.
- [Stacked on unmerged changes] → Rebased if `gh-3-ui-foundation` or `gh-3-ui-incident-workflow` change in review.
