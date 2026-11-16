# Design

## Context

A shape may name an attribute's allowed units on the attribute node: `sh:property [ sh:path ngsild:unitCode ; sh:in ( "CEL" ) ]`. The hints query reads only the value rules (`hasValue`, `hasObject`, `hasValueList`), so it misses them. A unit is described as `qudt:Unit` with `qudt:uneceCommonCode`, `qudt:symbol` and `rdfs:label`. A knowledge without them is common, so the editor needs units of its own to offer.

The broker's entity merge can't take a member away: a `unitCode` left out stays.

## Goals / Non-Goals

**Goals:** a unit changed or removed in place; codes rather than symbols; the data model's units where it names them.

**Non-Goals:** units derived from OPC UA; converting values; the add form.

## Decisions

### D1: The allowed units come with the hints

The hints answer gains `units`, from a second query for `sh:in` on `ngsi-ld:unitCode` under the attribute's node, for the same target classes as the value rules. A failed query gives no units; the hints themselves answer as before. A shape that names only units still gives them, with `hint_type: none`.

*Alternative:* a separate endpoint per attribute. One more request per edit, for data that belongs with the hints.

### D2: The units to offer: the knowledge's, else a built-in list

`/api/shacl/units` answers the knowledge's units when it describes any, else about 60 common UN/CEFACT Recommendation 20 codes with symbol and name, and says which (`source`). They are asked each time an editor opens; the answer is small and the same for every attribute, so it isn't kept across editors.

*Alternatives:*
- Only the knowledge's units. On a platform that describes none, the editor would offer nothing but free text.
- The whole Recommendation 20 list. Thousands of codes, most never used in a factory.

### D3: A cleared unit is written whole

`unitCode: null` in an update means "remove the unit". The attribute is written whole (`POST /entities/{id}/attrs`), with every instance where it has several, as a merge would keep the unit. At a path, the sub-attribute is changed inside the instance, which is written whole as before.

*Alternative:* a merge that gives the unit as NGSI-LD's null, `urn:ngsi-ld:null`, which the merge operations take as removing the member. The whole write is the one already used and checked for instances and paths here, and the null's support in the broker in use isn't established, so the whole write is preferred.

### D4: Codes in the editor, checked, with Save anyway

The editor's unit choice lists the data model's allowed units where there are any, else the units to offer, each as `CEL · °C · degree Celsius`, plus the stored unit, *No unit* and *Other code…*. A code outside the allowed ones, or unknown where the data model names none, is refused with the reason, and *Save anyway* writes it, as for a value: the explorer is also used to test how the system reacts. Changing only the unit writes the value as it is.

## Risks / Trade-offs

- The built-in list is a selection; a code it lacks is entered as another code, after the warning.
- The platform's alerts don't check units today, so a wrong unit written elsewhere isn't caught; the editor only guides what it writes.
