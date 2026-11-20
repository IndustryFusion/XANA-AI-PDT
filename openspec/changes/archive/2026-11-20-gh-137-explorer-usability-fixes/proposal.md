# Proposal

Issue: #137

## Why

Four things make the Data explorer harder to use than it needs to be (#137):

- *Delete by type* lists the entity types as checkboxes, and clearing a broker means ticking every one of them.
- Expanding a relationship target in place under one instance of a multi-relationship expands a target under every instance, and each of them shows the target that was clicked, not its own. This was finding 4 of the review of #118: a line's kept state is keyed without its dataset, so the instances share it.
- The entity a link opens (from an alert, an incident or a reference) is marked by a 1 px outline in the node's own tint, which is hardly visible among the other results.
- That entity is often not in view when the explorer opens: the explorer restores its kept scroll position after the entity has scrolled itself into view, and results loading above it move it again. Leaving the explorer through the main navigation also keeps the position after the navigation has moved the page to the top, so *Back through the navigation* comes back at the top, or, with an entity open, at that entity, which scrolls itself into view after the kept position is restored; neither is where the operator left.

## What Changes

- *Delete by type* offers **Select all types** above the types: it selects every listed type or none, shows a mixed state when some are selected, and is not offered for a single type. The types are still sent by name.
- Each instance of a multi-relationship expands its targets in place on its own and shows only its own targets. The instances keep sharing the toggle of their sub-attributes, as decided in the review of #81.
- The entity the explorer's address names, opened by a link or expanded in the list, is marked with a frame and a tinted header in the accent colour and a **Selected** label, and its frame pulses briefly on arrival unless the operator's system asks for reduced motion.
- Once the results are there, the explorer brings that entity into view, or the attribute line the link names, and keeps it there while content loading above moves it, for up to two seconds and until the operator scrolls. The kept scroll position is not restored over it.
- The explorer keeps its scroll position as the page scrolls, together with its address, and restores it when the operator comes back to that address.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `operator-ui/data-explorer`: *Import and bulk delete* (Select all types), *Explorer state is kept* (the kept scroll position); new *Relationship targets expanded per instance* and *The entity the address names*.

## Out of Scope

- One kept-view helper shared with the Alerts area, and keeping the position per history entry (#106). Like the Alerts area, the explorer now restores its position only at the address it was kept at.
- Separate sub-attribute toggles for the instances of a multi-attribute.
- Changes to the backend's delete by type, which already deletes several types in one request and refuses wildcards.
- Other areas than the Data explorer.

## Impact

Frontend only: the Data explorer's delete-by-type dialog, attribute lines, entity nodes, view and kept state, its styles, the mock data source's import (an attribute with several instances, as the broker takes it), and their unit and end-to-end tests. Affected section of architecture.md: none; the Data explorer row of *Frontend* already covers "the view kept when leaving the area".
