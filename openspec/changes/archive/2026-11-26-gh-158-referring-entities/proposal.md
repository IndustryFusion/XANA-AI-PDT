# Proposal

Issue: #158

## Why

The Data explorer follows relationships only downwards, from an entity to the targets of its own relationships. From a part the operator can't get to the machine it belongs to, or to anything else that refers to it, without knowing the referring entity's type and the relationship's name. NGSI-LD has no reverse lookup.

## What Changes

- The backend answers, for an entity ID, the entities that refer to it and the places they refer from: by relationships, lists of relationships and properties holding the ID, in every dataset instance and in sub-attributes at any depth.
- Every entity in the Data explorer, also one expanded in place, offers to show what refers to it. A referring entity can be expanded in place, with its own list, or opened at the attribute it refers from.
- Expanding all relationships still goes down only.

## Capabilities

### New Capabilities

### Modified Capabilities
- `backend/explorer-api`: new requirement **Referring entities**.
- `operator-ui/data-explorer`: new requirement **Referring entities**.

## Out of Scope

- Referring entities at a past moment (time-shift).
- References inside JSON, list, language, vocabulary and geo values.
- Keeping the list up to date by live updates: it is read when it is opened, when it is shown again and when the explorer reads its entities again, such as after a save.
- An index of references in the platform, which would make the search independent of the number of entities.

## Impact

- `backend/app/ngsi/references.py` (new), `backend/app/ngsi/broker.py`, `backend/app/api/ngsi.py`: the search and its endpoint `GET /api/ngsi/referenced-by`.
- `frontend/src/features/explorer/`: the list (`ReferencedBy.jsx`, new), its action in the entity's header, and the explorer's kept state; `frontend/src/data/`: one operation, `listReferrers`, in the interface and both sources.
- Affected sections of architecture.md: the Data explorer's row in the table of UI areas, and the `/api/ngsi/*` row in the table of endpoints; both name the new operation.
