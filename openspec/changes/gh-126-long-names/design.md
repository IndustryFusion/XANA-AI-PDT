# Design

## Context

`Iri` renders every IRI and identifier of the explorer: entity IDs, relationship targets, vocabulary values, types and IRI strings inside JSON values. It shows an http IRI by its short name and anything else as it is. An entity's heading is its name, else the short name of an http ID, else the last segment of the ID.

## Goals / Non-Goals

**Goals:** long names that fit their line, still telling one from another; the whole name at hand.

**Non-Goals:** a length setting; the raw JSON view; other areas.

## Decisions

### D1: Shortened in the middle, after the part that tells the kind

The start that says what a name is stays whole: `urn:<nid>:` or `prefix:`. An http IRI is always shown by its short name (*Every http IRI has a prefix*), so it is that short name that may be shortened, never the IRI itself. Of the rest, the first and last 6 characters are kept around an ellipsis. Names whose rest is 48 characters or less stay as they are, so ordinary NGSI-LD IDs such as `urn:ngsi-ld:Component:chiller-01-coolant-pump` don't change.

*Alternatives:*
- Cut at the end, as CSS's `text-overflow` does. IDs that share their start, as OPC UA's do, would look the same.
- Shorten by the space available. The same name would look different from place to place.

### D2: In full and back from the menu, one name at a time

*Show in full* and *Abbreviate* in a name's context menu change that one name in place. The tooltip always has the name in full, and the full IRI behind a prefixed name. Nothing else changes, so the full IRI still appears only in the tooltip and the menu.

*Alternative:* a setting for the whole explorer. *Short names for IRIs* has none on purpose, and one long name is what the operator wants to read.

### D3: The heading follows

A heading that falls back to the last segment of an ID is shortened the same way, with the ID as its tooltip; the ID link next to it offers the menu.

## Risks / Trade-offs

- Two long names that differ only in their middle look the same; the tooltip and *Show in full* tell them apart.
