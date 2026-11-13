# Proposal

Issue: #84

## Why

The IFF Digital Twin platform is starting to declare its doubles
(IndustryFusion/DigitalTwin#961, contract `contracts/typed-literals`). JSON-LD
1.1 makes a plain whole number an integer, `80.0` included, so the platform's
OPC UA tools and its SemForge SDK write every value of a double attribute as
`{"@value": 80.0, "@type": "http://www.w3.org/2001/XMLSchema#double"}`.

The context broker returns such a value as an object. Measured on Scorpio 0.10
and 6.0.2:

- **Reads and notifications** give `{"type": "http://www.w3.org/2001/XMLSchema#double", "@value": 80}`.
- **A merge keeps the stored type** and replaces only `@value`, so live values of
  such an attribute come back typed too, even the strings the live path sends:
  `{"type": "…#double", "@value": "42.5"}`.
- **A replacing update drops it**, so a plain `42.5` can appear again for the
  same attribute.

XANA reads a value as plain or as an IRI reference only. With a declared double:

- **Observe loses the live value.** The attribute drops out of its signals, and
  the facts it gives the model carry raw JSON.
- **Query conditions XANA evaluates itself fail.** Ranges, comparisons and
  patterns never match.
- **Edit protection is lost.** Text written to the double is accepted, and the
  broker then stores it as a double.
- **The Data explorer can't show or edit it.** It shows the raw object, offers no
  in-place edit, and marks unchanged values "Updated".

The platform's side lands first (IndustryFusion/DigitalTwin#962), but declared
values must not reach a broker XANA reads before this change is in.

## What Changes

- **XANA reads a declared value as its value:**
  - a value object (`@value`, with `type` or `@type`) is read as its `@value`;
  - a number written as a string inside a numeric value object is read as that number;
  - plain values and IRI references are read as before;
  - XANA does not depend on which of these forms the broker returns for an attribute.
- **The diagnostic workflow** counts a declared number among Observe's signals,
  with its unit and current value, and gives the model the plain value in its facts.
- **The explorer backend** evaluates query conditions on the plain value, and
  refuses text for a declared number as it does for a plain one.
- **The Data explorer:**
  - shows a declared value as its value and keeps it editable in place;
  - keeps its datatype when it is edited;
  - highlights it only when its value changed.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `backend/explorer-api`: query evaluation and edit validation read declared values.
- `backend/diagnostic-workflow`: Observe reads declared values.
- `operator-ui/data-explorer`: display, editing and live highlighting read declared values.

## Impact

- **architecture.md, *Data Layer*:** Scorpio's property values may be JSON-LD
  value objects. The TimescaleDB layout already stores a value's text and type
  separately (`value`, `valueType`), so history and time-shift are unaffected.
- **Backend:** the agent's reading of entity values, local query evaluation,
  and edit validation, each with tests; the real-broker tests round-trip a
  declared double.
- **Frontend:** the Data explorer's value display, in-place editing and live
  highlighting, with tests.
- **No new dependencies or infrastructure.**

## Out of Scope

- Writing declared values from XANA. An edit keeps the stored datatype; XANA
  does not declare types on values the operator creates.
- Strings declared as `xsd:string`, which the platform does not write.
- The `{"id": …}` form of IRI references in local query evaluation and the
  explorer's IRI helpers, an older and separate gap.
- Time-series data, which carries plain values.
- RAG, as set out in #18.
