# Proposal

Issue: #95

## Why

In the Data explorer, a sub-attribute added directly to an attribute is not stored as a
sub-attribute (#95). The explorer adds it through the context broker's entity-level merge.
The Scorpio image of the IFF Digital Twin platform (`ibn40/scorpio-all-in-one-runner:v0.7.0-latest`)
stores the merge's own result object there instead: `{"deleted": [], "result": {…}, "updated": null}`.
That object has no `type`, so it is no attribute, and the explorer shows nothing to expand. Properties and
relationships both get it. The existing real-broker test of adding a sub-attribute runs in CI against the local environment's broker
(`scorpiobroker/all-in-one-runner:java-latest`) and passes there, so the defect shows only on the platform's broker.

Sub-attributes one level deeper are already written differently: the backend reads the attribute, adds the
sub-attribute at its path and writes the whole attribute back. Those are stored correctly on both brokers.

## What Changes

- **Explorer API:** adding sub-attributes to an attribute itself, named by the attribute and no path, uses
  the same read-and-write-back as adding them at a path. It no longer depends on how the broker merges.
- **Explorer API, updates:** an update whose fragment brings a sub-attribute the attribute doesn't have yet
  writes the attribute back whole too, instead of merging it. That covers every client of the update route,
  among them the Data explorer's raw JSON editor.
- **Explorer API, live updates:** a write of a whole attribute counts as a change of the entity, so it arms the
  live-update delivery check, as the merge it replaces did.
- **Data explorer:** "Add sub-attribute" on an attribute uses that route, the same as on a sub-attribute. The
  new sub-attribute is shown under the attribute's expand control and can be expanded, edited and given
  sub-attributes of its own, at any depth.
- Nothing else changes: adding attributes, editing values and deleting keep their routes.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `backend/explorer-api`: *Sub-attributes at any depth* gains the case of a sub-attribute added to the
  attribute itself.
- `operator-ui/data-explorer`: *Edit attributes* gains the case of a sub-attribute added to an attribute,
  for every attribute kind.

## Out of Scope

- Repairing result objects that earlier adds left in the broker. They can be deleted in the raw JSON editor.
- How the explorer lays out sub-attributes; the expand control stays as it is.

## Impact

- Backend: the route that adds attributes (`POST /api/ngsi/entities/{id}/attrs` with `name`).
- Frontend: the explorer's add form, the backend data source and the mock data source.
- Tests: explorer API unit and real-broker tests, frontend data-source and explorer tests.
- architecture.md: none of its sections are affected.
