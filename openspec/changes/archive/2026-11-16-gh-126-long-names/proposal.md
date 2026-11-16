# Proposal

Issue: #126

## Why

Entity IDs from OPC UA instances are `urn:uaentity:` followed by about 120 characters of base64, and prefixed names built from them are as long. In the Data explorer they fill whole lines: the entity's heading, its ID link, a relationship's target, which then wraps onto a line of its own, and IRI values (#126). *Short names for IRIs* shortens http IRIs to `prefix:local` but keeps URNs as they are, and a prefixed name can still be long.

## What Changes

- A URN or prefixed name whose part after `urn:<nid>:` or `prefix:` is longer than 48 characters is shown with that start, its first and last 6 characters and an ellipsis: `urn:uaentity:c3Z1PX…01MDE4`.
- Its tooltip has the name in full, and the full IRI behind a prefixed name.
- Its context menu offers *Show in full*, then *Abbreviate*; the copy actions stay.
- An entity heading that falls back to a long ID's last segment is shortened the same way, with the ID as its tooltip.
- *Short names for IRIs* says that a long name's middle can be shown in place, and that a long URN is shortened.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `operator-ui/data-explorer`: *Short names for IRIs* (the scenarios *No full view in place* and *URNs*); new *Long names shortened in the middle*.

## Out of Scope

- Shortening names in the raw JSON view, which shows the document as it is.
- Shortening in other areas than the Data explorer.
- A setting for the length.

## Impact

Frontend only: `features/explorer/Iri.jsx`, the entity heading in `EntityNode.jsx`, and their tests.
