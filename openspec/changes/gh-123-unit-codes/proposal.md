# Proposal

Issue: #123

## Why

An attribute's unit can be given only when the attribute is added, as free text (*Unit (optional)*). Afterwards it can be changed or removed only in the raw JSON, and free text invites a symbol (`°C`) where NGSI-LD's `unitCode` is a UN/CEFACT common code (`CEL`) (#123). The IFF platform already says where allowed units come from: a shape names them with `sh:in` on `ngsild:unitCode`, and a unit is a `qudt:Unit` with its `qudt:uneceCommonCode`, symbol and name (DigitalTwin, SemForge-SDK, `semforge/cooked/units.py`).

## What Changes

- **Units in the hints:** `/api/shacl/hints` also answers `units`, the codes a shape allows for the attribute with `sh:in` on `ngsi-ld:unitCode`.
- **Units to offer:** `/api/shacl/units` answers the units the knowledge describes (`qudt:Unit` with `qudt:uneceCommonCode`, `qudt:symbol`, `rdfs:label`), else a built-in list of common UN/CEFACT codes, and says which.
- **Clearing a unit:** an update with `unitCode: null` removes the unit, writing the attribute whole, as the broker's merge can't take a member away.
- **Unit in the value editor:** beside the value and its datatype, a choice of units, each shown as code, symbol and name: the data model's allowed units, else the units to offer; the stored unit; *No unit*; and *Other code…*. A code the data model doesn't allow, or no known code, is refused with the reason and can be saved anyway.
- **Data source:** `getUnits`, and `units` in `getValueHints`.
- The editor's small selects and inputs keep their text whole.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `backend/ontology`: new *Units of an attribute*, *Units to offer*.
- `backend/explorer-api`: new *Clearing a unit*.
- `operator-ui/data-explorer`: new *Unit of a value*.
- `operator-ui/data-source`: *Value hints from the backend* (`getUnits`, `units`).

## Out of Scope

- Deriving a unit from OPC UA's `EngineeringUnits`.
- The unit in the add form, which stays free text.
- Converting values between units.

## Impact

Backend: `xana_agent/sources/ontology.py`, a new `xana_agent/sources/units.py`, `app/api/shacl.py`, `app/ngsi/broker.py`, and their tests. Frontend: the value editor and attribute line, the data interface and both sources, the interface documentation, and their tests.
