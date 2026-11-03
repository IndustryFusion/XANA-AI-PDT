# Proposal

Issue: #3

## Why

Diagnosing an incident needs context: the machine's live NGSI-LD state, its relationships and signal history, and the alerts raised around it. The foundation and incident workflow link to entities and alerts, but those areas are still placeholders. This change delivers the Data explorer and Alerts areas on mock data. It is the third of four changes delivering issue #3.

## What Changes

- **Data explorer** area:
  - query bar for entity type, entity ID, ID pattern, attribute filters built with a query builder, and limit;
  - entity list and entity view with typed attributes (property, relationship, geo, JSON, language, list, vocabulary, IRI-valued), sub-attributes, metadata and a raw JSON view;
  - navigation along relationships and IRIs with a context menu (open, copy, start incident, show incidents);
  - attribute editing with suggested values, adding and deleting attributes and sub-attributes, deleting entities;
  - attribute history as chart and table over a selectable time range;
  - time-shift to view entities as they were at a past moment;
  - import of entities from a file or URL with preview and per-entity results, and deletion of all entities of selected types;
  - live updates with a health indicator and highlighting of changed values.
- **Alerts** area: severity summary, filters (status, severity, environment, service, text), automatic refresh, table with selection and bulk actions, alert detail with history, and jumps to the affected entity, its incidents or a new incident.
- Mock implementations of the `entities` and `alerts` operations of the UI data interface, including signal history and simulated live updates.
- A charting library for attribute history.

## Capabilities

### New Capabilities

- `operator-ui/data-explorer`: Browsing, querying, navigating, editing, importing and watching NGSI-LD entities and their history.
- `operator-ui/alerts`: Viewing, filtering and acting on alerts, and moving from an alert to its context.

### Modified Capabilities

None.

## Impact

- Code: `frontend/src/features/explorer/`, `frontend/src/features/alerts/`, mock data source (`entities`, `alerts`, history series, live updates).
- UI data interface: implements the documented `entities` and `alerts` operations; no operation is added or renamed.
- Dependencies: one runtime dependency for charts (see `design.md`).
- `architecture.md` sections affected: none. Components → Frontend already describes both areas.

## Out of Scope

- Backend, backend adapter, real context broker, time-series store or alert manager.
- Editing NGSI-LD `@context` documents or entity types (schemas).
- Creating alerts or alert rules from the UI.
- Service settings for broker and alert-manager addresses (change 4).
