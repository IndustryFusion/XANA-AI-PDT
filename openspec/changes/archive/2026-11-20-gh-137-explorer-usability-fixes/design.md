# Design

## Context

- The delete-by-type dialog lists the broker's types as checkboxes and sends the selected ones by name; the backend deletes several types in one request and refuses wildcards such as `*`, so that no request deletes everything by accident.
- Each line of the entity document keeps its view state (sub-attributes open, relationship targets expanded in place) under a key made of the entity node and the attribute path. The instances of a multi-attribute have the same path, so they share it. For sub-attributes that was decided in the review of #81 and is pinned by a test; for relationship targets it was raised as finding 4 of the review of #118 and left for a later change.
- The node marked *current* is the one the explorer's address names: the entity a link opens, or the one the operator last expanded in the list, since expanding moves the address to it. It scrolls itself into view when it is first rendered. The explorer then restores its kept scroll position one frame later, and the results above it load afterwards.
- The explorer keeps its scroll position when it unmounts. Leaving through the main navigation, the router has already scrolled the page to the top by then, so the kept position is 0. *Back through the navigation* passes on the main branch only because no test checks the position after coming back.

## Goals / Non-Goals

**Goals:** clear all types in one step; expand one instance's target without touching the others; find the opened entity at a glance and without scrolling; come back to the scroll position the operator left.

**Non-Goals:** the shared kept-view helper of #106; separate sub-attribute toggles per instance; backend changes.

## Decisions

### D1: Select all types is a tri-state checkbox in the dialog

A checkbox above the types selects every listed type, in the list's order, or clears them all; while only some are selected, it shows the mixed state of a native checkbox. It is not offered for a single type, where it would do nothing a type's own checkbox doesn't. The types are still sent one by one by name, so the backend's refusal of wildcards stays in force.

*Alternatives:*
- A "Delete all entities" action sending `*` or no type: the backend refuses wildcards on purpose, and an action without a list of what goes would be easier to trigger by mistake.
- "Select all" and "Clear" buttons: two controls for one state, and no mixed state.

### D2: Relationship targets are kept per instance; sub-attributes stay shared

A line's expanded targets, the targets moved out of the tree from it, and the key of a nested entity node include the instance's dataset. The sub-attribute toggle keeps the key without the dataset. A line also shows only targets that are among its own, so a target kept under another key can never appear under it.

*Alternatives:*
- The dataset in every key of the line: separates the sub-attribute toggles too, which the review of #81 decided against.
- Only filtering the shown targets by the instance's own: the expand control would still read as expanded on every instance that has the same target, and a collapse under one would collapse all.

### D3: The entity the address names is framed, tinted and labelled

The mark follows the node the explorer's address names: the entity a link opened, and, as before for the address, the one the operator last expanded in the list, which moves the address to it. The node gets a 2 px frame in the accent colour with a soft halo, its header is tinted with the accent colour, and a *Selected* label follows its type, so it is recognised without telling colours apart. When the entity arrives, through a link from another area or within the explorer, the frame pulses twice, only when the system doesn't ask for reduced motion, like the app's other animations (whose global reduced-motion rule also shortens it to nothing); not for an entity the operator expanded in the list, nor on a return (D4). The pulse is over after 2.4 s, so a node that mounts again later, after a time-shift or a collapse and expand, does not pulse again. The attribute line a link names keeps its own mark.

*Alternatives:*
- A stronger outline only: still relies on colour, and is easy to miss in a long list.
- A banner above the results naming the entity: points at it without showing where it is.

### D4: The explorer brings the entity the address names into view until the operator scrolls

The router records how the current address was reached: opened or reloaded, a link or a navigation within an area, a *return* through the main navigation's entry (which goes back to an area's last place), or the browser's back and forward. A return, or back and forward, does not move the page to the entity: a return restores the kept position (D5), and back and forward inside the explorer leave the page to the browser, without the pulse. Every other way to an entity's address brings that entity into view once the results are there: its node's top just below the sticky header, or the attribute line the link names to the middle of the space below it. For up to two seconds it then moves the page each frame by what is still missing to that place, so a move the page's end cut short completes once the page grows, and loading content that moves the entity is made up for. The browser's scroll anchoring is off meanwhile, so the page moves only by the reveal or by the operator. A wheel, touch, key or mouse press by the operator ends it at once, and so does any movement of the page that the reveal did not make, such as dragging the scrollbar. It looks for the entity's own node, the current one or one shown on its own, never a copy nested under another entity. A focused attribute line no longer scrolls itself. What the address names, the entity and the attribute line, is brought into view once per change, so a later reload of the results does not start it again. The same applies to an entity the operator expands in the list, which moves the address to it and was brought to the top before; the entity node no longer scrolls on its own. *Go to* of an entity moved out of the tree puts it below the sticky header too.

*Alternative considered and dropped in review:* comparing the address with the one the position was kept at. A link to the entity the operator last had open would be taken for a return, and an address that changed without a scroll would make a return look like a link.

*Alternatives:*
- One scroll after the results are loaded: entities and attributes loading above the node still move it afterwards.
- Watching layout changes until the page is idle: no clear end, and it would move the page under an operator who has started reading.

### D5: The scroll position is kept as the page scrolls, with its address

The explorer keeps the position once a frame while the page scrolls, and whenever its address changes, together with that address, and only while the address is still the explorer's. It restores the position the same way as D4 places an entity: repeated each frame until the page is long enough for it, or the operator scrolls, and without keeping the position meanwhile, so a page still too short never replaces the kept position with a shorter one. It restores it only at the address it was kept at, as the Alerts area does: on a return and on back and forward (D4), and when it opens at that address without naming an entity. Elsewhere the page starts at the top, or at the entity (D4).

*Alternatives:*
- Keep it at unmount, as now: the navigation has already moved the page to the top by then.
- Keep it before every navigation away: the router would need to know about the explorer's state.
- Restore only at the kept address on every visit: that is #106, together with a helper shared with the Alerts area.

### D6: The mock data source imports multi-attributes

The mock's import refused an attribute given as a list of instances, which the broker takes and the explorer shows. It now checks each instance of such a list as it checks a single attribute, so the end-to-end tests can import an entity with a multi-relationship.

*Alternative:* add a multi-relationship to the mock's seed: it would change the counts and views many existing tests rely on.

## Risks / Trade-offs

- An operator who starts reading within two seconds without scrolling or pressing a key could still see the page move once if content above loads; the movement stops at the first scroll or key.
- The pulse is a brief animation; under reduced motion it is not shown.
- Keeping the position once a frame while scrolling costs one read of the scroll position per frame of scrolling.
