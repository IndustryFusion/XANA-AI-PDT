# Proposal

Issue: #109

## Why

The Data explorer shows attributes as the context broker holds them, while alerts are checked against the latest values the time-series store records. A value written with an older observation time, or an instance the time series records as deleted, makes the two disagree, and nothing tells the operator that the value shown isn't the one alerts look at (#109).

The backend reads the latest recorded state only per attribute. For an attribute with several instances (datasets), the latest row of any instance stands for all of them, so a deleted default instance makes another instance look deleted.

## What Changes

- **Explorer API:** the latest recorded state of an entity's attributes also gives the latest state of each instance, keyed by its dataset (`@none` for the default instance). The attribute-level state stays as it is: the latest row of any instance.
- **Data explorer:** a top-level attribute value is marked when its instance has a later observation in the time series, or is recorded there as deleted:
  - a small attention mark beside the value, with a tooltip that says what is wrong;
  - the value, its unit and its observation time are shown faint;
  - each instance is compared with its own dataset only, and observation times are compared as instants;
  - after a save, the time-series state is read again, so the mark follows the save.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `backend/explorer-api`: *History from the time-series store*, scenario *Latest state* gains the state per instance.
- `operator-ui/data-explorer`: new requirement *Values behind the time series*.

## Out of Scope

- Sub-attributes: the latest state is read for top-level attributes only, as today.
- The history's notice that an attribute is deleted (*Attribute history*) keeps using the attribute-level state.
- Repairing the broker or the time series when they disagree.

## Impact

- Backend: the latest-state read of the time-series store (`GET /api/ngsi/attr-status`).
- Frontend: the explorer's attribute lines, the entity node's state reads, the data-source contract and the mock source.
- Tests: explorer history tests in the backend, explorer tests in the frontend.
- architecture.md: none of its sections are affected.
