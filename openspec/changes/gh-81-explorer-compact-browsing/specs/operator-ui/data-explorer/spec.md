# Spec Delta

## MODIFIED Requirements

### Requirement: Query entities
The Data explorer SHALL let the operator query entities by type, entity ID, ID pattern and attribute filters with a result limit, and keep the query in the URL. Type, entity ID and Search SHALL be on one row; the other filters SHALL be in a collapsible section that, when collapsed, shows each filter that is set as a removable chip.

#### Scenario: Query by type
- **WHEN** the operator selects an entity type and applies the query
- **THEN** the matching entities are listed with ID, type and name, and the URL reflects the query

#### Scenario: Attribute filter
- **WHEN** the operator adds attribute conditions in the query builder and chooses how they combine
- **THEN** only entities satisfying the conditions are listed and the resulting query expression is shown

#### Scenario: No results
- **WHEN** no entity matches
- **THEN** the list says that no entities matched the query

#### Scenario: Invalid query
- **WHEN** the query is rejected as invalid
- **THEN** the reason is shown next to the query bar and the previous results stay

#### Scenario: Collapsed filters
- **WHEN** the further filters are collapsed and a has-attribute filter and a limit are set
- **THEN** both show as chips next to the query row, and removing a chip clears that filter and applies the query again

#### Scenario: Compact query bar
- **WHEN** the further filters are collapsed, at a window width of 1280 pixels
- **THEN** the first listed entity starts no more than 150 pixels below the top of the query bar

### Requirement: Entity view
Selecting an entity SHALL expand it in the result list as a structured document in the entity's own attribute order: one line per attribute with a kind label, name and value, plus units, observation times, metadata and sub-attributes at any depth, with a toggle to an editable raw JSON; the URL SHALL identify the expanded entity. Sub-attributes SHALL be shown in the same kind of line as attributes.

#### Scenario: Typed attributes
- **WHEN** an entity with properties, relationships, geo, JSON, language, list and vocabulary attributes is shown
- **THEN** each attribute shows its kind as a label and a value presentation suited to that kind

#### Scenario: Raw JSON
- **WHEN** the operator switches to the raw view
- **THEN** the entity's JSON is shown and can be copied

#### Scenario: Edit the raw JSON
- **WHEN** the operator changes the raw JSON and saves it
- **THEN** added, changed and removed attributes are applied to the entity, and invalid JSON is reported without saving

#### Scenario: Entity not found
- **WHEN** the URL names an entity that does not exist
- **THEN** the view states that the entity was not found and keeps the query bar usable

#### Scenario: Deep sub-attributes
- **WHEN** an attribute has a sub-attribute that itself has a sub-attribute
- **THEN** each level is shown as its own line, indented under its parent with a tree line, with the same kind label, value presentation and actions as an attribute

#### Scenario: One expand control
- **WHEN** an entity, attribute or sub-attribute has children
- **THEN** it shows one expand control with the number of children, the same at every depth, and the control expands and collapses them

### Requirement: Relationship and IRI navigation
Relationship targets and IRI values SHALL be navigable, and relationship targets SHALL also expand in place, nested under the attribute. Copy, open and incident actions on entities, attributes and IRIs SHALL be offered in one context menu, opened by right-click or from the keyboard, and not as controls in the rows.

#### Scenario: Follow a relationship
- **WHEN** the operator selects a relationship target
- **THEN** the target entity opens and the browser back button returns to the previous entity

#### Scenario: Expand a relationship in place
- **WHEN** the operator expands a relationship target
- **THEN** the target entity is shown nested and indented under the attribute, and a target already shown above it in the same tree is marked instead of expanded again

#### Scenario: Context menu on an IRI
- **WHEN** the operator right-clicks an IRI value, or focuses it and presses Shift+F10 or the Menu key
- **THEN** a menu offers copy the short name, copy the full IRI, open in the Data explorer, start a new incident, show active incidents and show incident history, and Escape closes it with focus back on the IRI

#### Scenario: Context menu on an attribute
- **WHEN** the operator opens the context menu of an attribute or sub-attribute
- **THEN** it offers copy the short name, copy the full IRI and copy the value

#### Scenario: No incident controls in the rows
- **WHEN** an entity with relationships is shown
- **THEN** no row holds a control for starting an incident or showing incidents; those are reached only through the context menu

#### Scenario: Nested entities
- **WHEN** a relationship target is expanded in place
- **THEN** the nested entity offers no delete and no raw JSON; those are offered on top-level and unnested entities

### Requirement: Edit attributes
The operator SHALL be able to change attribute and sub-attribute values in place on their line, add attributes and sub-attributes at any depth, and delete attributes, sub-attributes and entities, with suggested values where the data model provides them and confirmation before deleting. Adding SHALL offer every NGSI-LD attribute kind, and names built from the prefixes in use.

#### Scenario: Change a value with suggestions
- **WHEN** the operator selects the value of an attribute that has suggested values
- **THEN** the value becomes an input in place offering the suggestions, Enter saves and updates the value shown, and Escape cancels

#### Scenario: Rejected change
- **WHEN** a change is rejected
- **THEN** the editor stays open with the entered value and shows the reason

#### Scenario: Delete a sub-attribute
- **WHEN** the operator deletes a sub-attribute and confirms
- **THEN** only that sub-attribute is removed and the attribute remains

#### Scenario: Add a sub-attribute at depth
- **WHEN** the operator adds a sub-attribute to a sub-attribute
- **THEN** it is saved under that sub-attribute, the rest of the attribute is unchanged, and it is shown at its place

#### Scenario: Every kind
- **WHEN** the operator opens the add form
- **THEN** it offers Property, Relationship, GeoProperty, JsonProperty, LanguageProperty, ListProperty and VocabularyProperty

#### Scenario: Name from a prefix
- **WHEN** the operator picks a prefix and enters a local name in the add form
- **THEN** the attribute is saved under the prefix's full IRI followed by the local name, and is shown with its short name

### Requirement: Attribute history
For attributes and sub-attributes with recorded history the UI SHALL show the values over a selectable time range as a chart for numeric values and as a table for all values. An attribute whose latest recorded state is deleted SHALL say so.

#### Scenario: Numeric history
- **WHEN** the operator opens the history of a numeric attribute and picks a time range
- **THEN** a chart and a table of the values in that range are shown, with the unit

#### Scenario: Empty range
- **WHEN** no value was recorded in the selected range
- **THEN** the history says that there is no data in this time range

#### Scenario: Chart alternative
- **WHEN** the chart is shown
- **THEN** the same values are available in the table, so the information does not depend on seeing the chart

#### Scenario: Deleted attribute
- **WHEN** the operator opens the history of an attribute whose latest recorded state is deleted
- **THEN** the history says when it was deleted, and still shows its earlier values

#### Scenario: Attribute without an observation time
- **WHEN** the store holds rows for an attribute that states no observation time
- **THEN** its history can be opened

#### Scenario: History service unavailable
- **WHEN** the history cannot be read
- **THEN** the history says so with the reason, and the rest of the explorer keeps working

#### Scenario: Sub-attribute history
- **WHEN** a sub-attribute has an observation time
- **THEN** its history can be opened from its line, the same as an attribute's

### Requirement: Live updates
The Data explorer SHALL show attribute changes as they happen when live updates are on, highlight changed values briefly, and indicate whether live updates are working, connecting or unavailable, with the reason the backend gives. When they stop working, it SHALL recover by itself once they work again.

#### Scenario: Value changes live
- **WHEN** live updates are on and a shown attribute changes
- **THEN** the new value appears without a reload and is highlighted briefly

#### Scenario: Live updates unavailable
- **WHEN** live updates cannot be delivered
- **THEN** the indicator says so, its reason is shown with it, and the explorer keeps working without them

#### Scenario: Being set up
- **WHEN** the backend reports that live updates are still being set up, such as just after sign-in
- **THEN** the indicator says they are connecting, not that they are unavailable

#### Scenario: Live updates return
- **WHEN** live updates work again
- **THEN** the indicator shows it, what is shown is read again, so that changes from the outage appear, and later changes appear with no reload

#### Scenario: Only what changed is highlighted
- **WHEN** a notification holds the whole entity, and one attribute differs from what is shown
- **THEN** only that attribute is highlighted

## ADDED Requirements

### Requirement: Short names for IRIs
The Data explorer SHALL show types, attribute names, entity IDs, relationship targets and IRI values as `prefix:local`. Prefixes SHALL come first from the configured context, then from well-known vocabularies, then from a short name derived per namespace. A prefix SHALL keep its namespace until reload. The full IRI SHALL stay available on hover, per name and for all names.

#### Scenario: Platform data
- **WHEN** entities whose types and attributes are full IRIs are shown
- **THEN** each is shown as a short name, and hovering a short name shows its full IRI

#### Scenario: Stable prefixes
- **WHEN** the operator runs a second query whose results hold a namespace seen in the first
- **THEN** that namespace has the same prefix as before

#### Scenario: Context first
- **WHEN** the configured context defines a prefix for a namespace
- **THEN** that prefix is used for it, rather than a well-known or derived one

#### Scenario: No configured context
- **WHEN** no context is configured, or its prefixes can't be read
- **THEN** well-known and derived prefixes are used, and the explorer works as usual

#### Scenario: One name in full
- **WHEN** the operator clicks a short name
- **THEN** that name shows its full IRI, and clicking again shows the short name

#### Scenario: All names in full
- **WHEN** the operator turns on showing full IRIs
- **THEN** every name is shown in full, and the choice is kept after a reload

#### Scenario: Prefix legend
- **WHEN** the operator opens the prefix legend
- **THEN** every prefix in use is listed with its namespace and where it comes from

#### Scenario: Not an http IRI
- **WHEN** an identifier is a URN or another IRI without a namespace to shorten
- **THEN** it is shown unchanged

### Requirement: Icon actions
The actions on entities, attributes and sub-attributes SHALL be icon buttons from one icon set, each with a tooltip and an accessible name. They SHALL be visible without hovering and reachable from the keyboard.

#### Scenario: Icons in the rows
- **WHEN** an entity with attributes and sub-attributes is shown
- **THEN** history, edit, add sub-attribute, delete, raw JSON, pin, unnest and re-nest, where offered, are icons with no visible text, and each names its action as tooltip and to assistive technology

#### Scenario: Without hovering
- **WHEN** the pointer is not over a row
- **THEN** that row's actions are still shown

#### Scenario: Keyboard
- **WHEN** the operator moves through a row with the keyboard
- **THEN** each action can be reached and triggered, and its focus is visible

### Requirement: Unnest and re-nest
An entity expanded in place through a relationship SHALL be movable out of its parent to its own place in the list, and back. This SHALL change the view only, never the data.

#### Scenario: Unnest
- **WHEN** the operator unnests an entity expanded under a relationship
- **THEN** it is shown as its own entity after the results, with its expansion kept, and the relationship shows a link that moves to it

#### Scenario: Re-nest
- **WHEN** the operator re-nests an unnested entity
- **THEN** it is removed from its own place and shown again under the relationship it came from, if that is still shown

#### Scenario: Data unchanged
- **WHEN** an entity is unnested or re-nested
- **THEN** no request changes any entity

#### Scenario: New query
- **WHEN** the operator applies a new query
- **THEN** unnested entities that are not pinned are removed from the view

### Requirement: Pinning
The operator SHALL be able to pin top-level and unnested entities. A pinned entity SHALL stay at the top of the list through new queries and reloads, until unpinned.

#### Scenario: Pin
- **WHEN** the operator pins an entity and applies a query that doesn't match it
- **THEN** the entity is still listed at the top, marked as pinned, and the list says how many are pinned

#### Scenario: Unpin a selection
- **WHEN** the operator selects several pinned entities and unpins them
- **THEN** they are no longer pinned, and stay only if the query matches them

#### Scenario: After a reload
- **WHEN** the operator reloads the page
- **THEN** the pinned entities are listed again at the top, read anew

#### Scenario: Pinned entity gone
- **WHEN** a pinned entity no longer exists
- **THEN** it is listed as not found, and can be unpinned

### Requirement: Explorer state is kept
The Data explorer SHALL show the same view after the operator leaves it and comes back, whether through the main navigation or the browser's back button. A reload SHALL keep the query and the pins.

#### Scenario: Back through the navigation
- **WHEN** the operator has a query with results, expanded entities and attributes, an unnested entity and a scroll position, opens another area and selects the Data explorer in the navigation
- **THEN** the same query, results, expansions, unnested entity and scroll position are shown

#### Scenario: Back with the browser
- **WHEN** the operator returns to the Data explorer with the browser's back button
- **THEN** the same view is shown as through the navigation

#### Scenario: Values brought up to date
- **WHEN** the operator comes back after attributes changed meanwhile
- **THEN** the kept view shows the current values

#### Scenario: Reload
- **WHEN** the operator reloads the Data explorer
- **THEN** the query and pins are kept, and expansions start collapsed except for the entity in the URL
