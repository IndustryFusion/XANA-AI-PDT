# operator-ui/data-explorer Specification

## Purpose
Lets operators inspect and maintain the plant's digital twin: query NGSI-LD entities, follow their relationships, edit attribute values, see how signals changed over time and as the twin was at a past moment, and watch values change live.

## Requirements

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
Selecting an entity SHALL expand it in the result list as a structured document in the entity's own attribute order: one line per attribute with a kind label, name and value, plus units, observation times, metadata and sub-attributes at any depth, with a toggle to an editable raw JSON, which shows the entity as stored, full IRIs included: the one exception to "Short names for IRIs". The URL SHALL identify the expanded entity. Sub-attributes SHALL be shown in the same kind of line as attributes.

#### Scenario: Typed attributes
- **WHEN** an entity with properties, relationships, geo, JSON, language, list and vocabulary attributes is shown
- **THEN** each attribute shows its kind as a label and a value presentation suited to that kind

#### Scenario: Raw JSON
- **WHEN** the operator chooses the raw JSON action
- **THEN** the entity's JSON is shown as stored, with its full IRIs, and can be copied; closing it shows the short names again

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
- **WHEN** the operator right-clicks an IRI value or relationship target, or focuses it and presses Shift+F10 or the Menu key
- **THEN** a menu offers copy the short name, show the full IRI, copy the full IRI, open in the Data explorer, start a new incident, show active incidents and show incident history, and Escape closes it with focus back on the IRI

#### Scenario: Context menu on an attribute
- **WHEN** the operator opens the context menu of an attribute or sub-attribute
- **THEN** it offers copy the short name, show the full IRI, copy the full IRI and copy the value

#### Scenario: Context menu on a type or entity ID
- **WHEN** the operator opens the context menu of an entity's type or of its ID
- **THEN** it offers copy the short name, show the full IRI and copy the full IRI, together with the entity's open and incident items

#### Scenario: Show the full IRI
- **WHEN** the operator chooses "Show full IRI" in a context menu
- **THEN** a small popover next to the name shows the full IRI as selectable text until the operator dismisses it with Escape or by clicking outside, and focus returns to the name, which stays short

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

#### Scenario: Add a sub-attribute to an attribute
- **WHEN** the operator adds a sub-attribute to an attribute of any kind, a relationship included
- **THEN** it is saved under that attribute, the attribute keeps its value or target and stays one attribute, and the sub-attribute is shown under the attribute's expand control, which is open, and can be expanded and given sub-attributes of its own

#### Scenario: Add a sub-attribute at depth
- **WHEN** the operator adds a sub-attribute to a sub-attribute
- **THEN** it is saved under that sub-attribute, the rest of the attribute is unchanged, and it is shown at its place

#### Scenario: Every kind
- **WHEN** the operator opens the add form
- **THEN** it offers Property, Relationship, GeoProperty, JsonProperty, LanguageProperty, ListProperty and VocabularyProperty

#### Scenario: Name from a prefix
- **WHEN** the operator picks a prefix and enters a local name in the add form, or types `prefix:local` with a known prefix
- **THEN** the attribute is saved under the prefix's namespace followed by the local name, and is shown with its short name

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

### Requirement: Time-shift
The operator SHALL be able to view entity types and entities as they were at a chosen past moment, clearly marked as a historical view, and return to the present.

#### Scenario: View the past
- **WHEN** the operator picks a past moment
- **THEN** types and entities are shown as of that moment, editing is disabled, and a banner names the moment with a way back to the present

### Requirement: Import and bulk delete
The operator SHALL be able to import entities from a file or a URL after a preview, see the result per entity, and delete all entities of selected types after confirmation, where one control selects all listed types at once.

#### Scenario: Import from file
- **WHEN** the operator chooses a JSON file of entities, reviews the preview and confirms
- **THEN** the entities are imported and each entity's result (created, updated or failed with reason) is listed

#### Scenario: Invalid file
- **WHEN** the file is not valid NGSI-LD JSON
- **THEN** the preview explains the problem and import is not offered

#### Scenario: Delete by type
- **WHEN** the operator selects entity types, confirms deletion and the deletion completes
- **THEN** the number of deleted entities per type is shown and the list is refreshed

#### Scenario: Select all types
- **WHEN** the delete-by-type dialog lists several types and the operator selects *Select all types*
- **THEN** every listed type is selected, the confirmation names them all, and each is deleted by its name; selecting it again clears them all, and while only some types are selected it shows a mixed state

#### Scenario: A single type
- **WHEN** the delete-by-type dialog lists one type
- **THEN** *Select all types* is not offered

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

### Requirement: Allowed ranges while editing
The value editor SHALL show the allowed range of a value, where the data model gives one, as well as its suggested values. It SHALL work the same when there are no hints.

#### Scenario: Range shown
- **WHEN** the operator edits a value with an allowed range
- **THEN** the range is shown next to the input, saying whether each limit is included

#### Scenario: No hints
- **WHEN** no hints exist
- **THEN** the editor works as usual, and no error is shown

#### Scenario: Hints can't be read
- **WHEN** hints can't be read, for example for a missing role or a wrong graph base
- **THEN** the editor works as usual, and says why there are no suggestions

### Requirement: Paging through results
The Data explorer SHALL page through query results beyond the first page, with the page kept in the URL.

#### Scenario: Next and previous
- **WHEN** a query has more matches than the limit
- **THEN** the explorer shows which matches are shown and the total when known, and next and previous pages can be opened until the last

#### Scenario: Page in the URL
- **WHEN** the operator opens a URL holding a query and a page
- **THEN** that page of results is shown

#### Scenario: New query
- **WHEN** the operator changes the query
- **THEN** the results start again at the first page

### Requirement: Attribute selection and has-attribute filter
The Data explorer SHALL let the operator choose the attributes to return, and filter to entities that have a given attribute, from the attributes the broker knows, and keep both in the URL.

#### Scenario: Choose attributes
- **WHEN** the operator selects attributes to return and applies the query
- **THEN** the listed entities show only those attributes

#### Scenario: Has attribute
- **WHEN** the operator sets "Has attribute" to an attribute and applies the query
- **THEN** only entities that have it are listed, each whole

### Requirement: Import replaces
The import dialog SHALL say, before the operator confirms, that importing replaces entities that already exist and removes attributes that are not in the file.

#### Scenario: Preview
- **WHEN** the operator previews an import
- **THEN** the dialog says that existing entities are replaced, and the result lists replaced entities as updated

### Requirement: Short names for IRIs
The Data explorer SHALL show every http(s) IRI as `prefix:local`, or `prefix:` for a namespace, and never in full except in the raw JSON view. The full IRI SHALL appear only in the tooltip and through the context menu's "Show full IRI" and "Copy full IRI". Prefixes SHALL come from the configured context, then well-known vocabularies, then a name derived per namespace, and SHALL keep their namespace until reload.

#### Scenario: Platform data
- **WHEN** entities whose types and attributes are full IRIs are shown
- **THEN** each is shown as a short name, and hovering a short name shows its full IRI as tooltip

#### Scenario: Stable prefixes
- **WHEN** the operator runs a second query whose results hold a namespace seen in the first
- **THEN** that namespace has the same prefix as before

#### Scenario: Context first
- **WHEN** the configured context defines a prefix for a namespace
- **THEN** that prefix is used for it, rather than a well-known or derived one

#### Scenario: No configured context
- **WHEN** no context is configured, or its prefixes can't be read
- **THEN** well-known and derived prefixes are used, and the explorer works as usual

#### Scenario: No full view in place
- **WHEN** the operator clicks a short name, or looks for a setting to show names in full
- **THEN** the name stays short and no such setting exists; clicking does only what clicking that element otherwise does, such as following a relationship. Only a long name's middle can be shown in place, through its context menu (*Long names shortened in the middle*), and the full IRI still only in the tooltip and the menu

#### Scenario: Prefix legend
- **WHEN** the operator opens the prefix legend
- **THEN** every prefix in use is listed with where it comes from (context, well-known or derived), and each namespace is shown only in its tooltip and through its context menu

#### Scenario: Namespace of scheme and host only
- **WHEN** an IRI's namespace is only scheme and host, such as `http://example.org/x`, or the IRI is the bare `http://example.org`
- **THEN** it is shown with a prefix, such as `example:x` and `example:`

#### Scenario: IRI that is a namespace
- **WHEN** an IRI ends in `/` or `#`, such as `http://opcfoundation.org/UA/Pumps/`
- **THEN** it is shown as its prefix followed by a colon, such as `pumps:`

#### Scenario: Every http IRI has a prefix
- **WHEN** any http or https IRI is shown anywhere in the explorer outside the raw JSON view
- **THEN** it is shown with a prefix, and never unchanged

#### Scenario: URNs
- **WHEN** an identifier is a URN, such as `urn:ngsi-ld:Pump:1`, or a term without a colon that the broker compacted through a configured context
- **THEN** it is shown as it is, or shortened in the middle when it is long (*Long names shortened in the middle*): a URN is an entity identifier, not an IRI in a namespace, so this is not an exception to the rule

### Requirement: Short names in every part of the explorer
The rule of "Short names for IRIs" SHALL hold wherever the Data explorer shows an IRI, not only in the entity tree. Wherever a list or select offers IRIs, each option SHALL show its short name, with the full IRI as its tooltip.

#### Scenario: Query bar
- **WHEN** the operator uses the type select, has-attribute, attributes to return or the condition builder, or the collapsed filters show as chips
- **THEN** every type and attribute name in their options, entries and chips is shown as a short name

#### Scenario: Add form
- **WHEN** the operator adds a relationship and chooses its target
- **THEN** the offered and chosen targets are shown as short names

#### Scenario: Value suggestions
- **WHEN** the value editor suggests values that are IRIs
- **THEN** each suggestion is shown as a short name, and choosing one saves the full IRI

#### Scenario: History pane
- **WHEN** the history of an attribute is open
- **THEN** its title shows the attribute's short name, and relationship targets and IRI values in its table are shown as short names

#### Scenario: Time-shift banner
- **WHEN** the time-shift banner is shown with the types it applies to
- **THEN** each type is shown as a short name

#### Scenario: Import
- **WHEN** the import preview or the import result list is shown
- **THEN** every entity ID, type and attribute name that is an http(s) IRI is shown as a short name

#### Scenario: Delete by type
- **WHEN** the delete-by-type dialog is shown
- **THEN** the type it names is shown as a short name

#### Scenario: Entity title from its ID
- **WHEN** an entity has no name and its title falls back to its ID, and the ID is an http(s) IRI
- **THEN** the title is the ID's short name

#### Scenario: Messages
- **WHEN** a message names an entity or attribute, such as "not found" or a rejected change
- **THEN** the name in the message is its short name

#### Scenario: IRIs inside values
- **WHEN** a JSON, List or Vocabulary value holds strings that are http(s) IRIs
- **THEN** each such string is shown as a short name, with the same tooltip and context menu as any other IRI

### Requirement: Short names as input
Wherever the operator types an IRI in the Data explorer, `prefix:local` with a known prefix SHALL be expanded before any request is sent, and a known prefix SHALL win over a URI scheme of the same name. Otherwise, an identifier field SHALL send a valid absolute URI as typed, and a name field SHALL refuse an unknown prefix, naming it, with nothing sent.

#### Scenario: Known prefix
- **WHEN** the operator types `prefix:local` with a known prefix as type, entity ID, the start of the ID pattern, has-attribute, a condition's attribute, a condition's value that is an IRI, a relationship target or a new attribute's name
- **THEN** the request names the prefix's namespace followed by the local name

#### Scenario: Full IRI typed
- **WHEN** the operator types a full http(s) IRI or a URN in any of these places
- **THEN** it is sent as typed

#### Scenario: Other URI scheme
- **WHEN** the operator types an absolute URI in another scheme, such as `did:example:123`, in an identifier field (entity ID, ID pattern, relationship target, IRI value), and `did` is not a known prefix
- **THEN** it is sent as typed

#### Scenario: Unknown prefix
- **WHEN** the operator types `x:local` in a name field (type, has-attribute, a condition's attribute, a new attribute's name), where `x` is not a known prefix
- **THEN** the input says that the prefix is unknown, names it, and no request is sent

#### Scenario: Prefix with the name of a scheme
- **WHEN** a known prefix has the same name as a URI scheme, and the operator types `name:local`
- **THEN** it is expanded with the prefix, and typing the full IRI instead sends that IRI

#### Scenario: Text values in conditions
- **WHEN** the operator enters a text, number or date value that contains a colon in a condition, such as `10:30` or `mode:auto`
- **THEN** the value is sent unchanged, even if the part before the colon is a known prefix

### Requirement: Icon actions
The actions in the Data explorer's rows and headers SHALL be icon buttons from one icon set, each with a tooltip and an accessible name, and no row or header SHALL hold a text button. They SHALL be visible without hovering and reachable from the keyboard. Confirm dialogs SHALL keep text buttons.

#### Scenario: Icons in the rows
- **WHEN** an entity with attributes and sub-attributes is shown
- **THEN** history, edit, add sub-attribute, delete, raw JSON, pin, unnest and re-nest, where offered, are icons with no visible text, and each names its action as tooltip and to assistive technology

#### Scenario: Icons in headers and panes
- **WHEN** an entity, a relationship target, the history pane or the raw JSON editor is shown
- **THEN** add attribute and delete entity on the entity, the relationship target's expand, close history, and the raw JSON editor's copy, save and cancel are icons with a tooltip and an accessible name

#### Scenario: Confirm dialogs
- **WHEN** a confirm dialog is shown, such as before deleting
- **THEN** its buttons are text

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
The Data explorer SHALL show the same view after the operator leaves it and comes back, whether through the main navigation or the browser's back button, with the scroll position the page had at that address when the operator left it. A reload SHALL keep the query and the pins.

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

#### Scenario: Back to an open entity
- **WHEN** the operator has an entity open in the explorer, scrolls away from it, opens another area and selects the Data explorer in the navigation
- **THEN** the page is at the scroll position it had when the operator left, not at the open entity

### Requirement: Declared values
The Data explorer SHALL show a property value that arrives as a value object -- `@value` with its datatype as `type` or `@type` -- as that `@value`, and a number written as a string inside a value object of a numeric datatype as that number, whether it arrives with the entity or as a live update. Such a value SHALL be editable in place like a plain one, an edit SHALL keep its datatype unless the operator chooses another, and a live update SHALL highlight it only when its value changed.

#### Scenario: Declared double shown
- **WHEN** an entity's `temperature` arrives as `{"type": "http://www.w3.org/2001/XMLSchema#double", "@value": 42.5}`
- **THEN** the attribute shows `42.5`

#### Scenario: Declared double edited in place
- **WHEN** the operator edits that `temperature` in place and enters `80`
- **THEN** the value is saved, reads back as `80`, and is still a declared double in the broker

#### Scenario: Same value, other form
- **WHEN** a live update brings `{"type": "http://www.w3.org/2001/XMLSchema#double", "@value": "42.5"}` for a `temperature` shown as `42.5`
- **THEN** it is not highlighted as changed

#### Scenario: Changed declared value
- **WHEN** a live update brings `{"type": "http://www.w3.org/2001/XMLSchema#double", "@value": 43}`
- **THEN** the attribute shows `43` and is highlighted as changed

### Requirement: Open at an attribute
A link to an entity in the Data explorer SHALL be able to name an attribute path of that entity: an attribute and the sub-attributes below it, each optionally with a dataset index such as `[0]`. The explorer SHALL expand each level down to the named line, bring that line into view and mark it. Only the entity the link opens SHALL show the mark, and a path the entity doesn't have SHALL open the entity as without a path.

#### Scenario: Link to a sub-attribute
- **WHEN** a link names an entity and the path of an attribute, a sub-attribute of it with a dataset index, and a sub-attribute below that
- **THEN** the attribute and the sub-attribute above the named line are expanded, the named line is in view and marked, and no other line is marked

#### Scenario: Path the entity doesn't have
- **WHEN** a link names an attribute the entity doesn't have
- **THEN** the entity opens as without a path and no line is marked

### Requirement: Values behind the time series
Alerts are checked against the latest values the time-series store records. The Data explorer SHALL mark a top-level attribute value whose instance has a later observation in the time series than the one shown, or is recorded there as deleted: with a small attention mark beside the value whose tooltip says what is wrong, and with the value, its unit and its observation time shown faint. Each instance SHALL be compared with the latest state of its own dataset only.

#### Scenario: Newer value in the time series
- **WHEN** the time series holds a later observation of an attribute's instance than the one shown
- **THEN** a mark beside the value says that the time series holds a more recent value, that alerts check the latest value, and to see the history, and the value is shown faint

#### Scenario: Deleted in the time series
- **WHEN** the time series records an attribute's instance as deleted while the broker still holds it
- **THEN** a mark beside the value says that the time series records it as deleted, and the value is shown faint

#### Scenario: Another instance deleted
- **WHEN** the default instance of an attribute is recorded as deleted, and the instance shown is another one that is still present
- **THEN** the instance shown is not marked

#### Scenario: A value as recent as the time series
- **WHEN** a marked value is replaced by a live update or a reload with a value observed as late as the time series' latest, or later
- **THEN** the mark is gone and the value is no longer faint

#### Scenario: Instance not in the time series
- **WHEN** the time series holds no row for the instance shown
- **THEN** the value is not marked

#### Scenario: Same time in another notation
- **WHEN** the time series and the broker give the same observation time in different notations
- **THEN** the value is not marked

#### Scenario: Reachable by keyboard
- **WHEN** the operator moves through the explorer with the keyboard or a screen reader
- **THEN** the mark can be focused, and its text is read out

#### Scenario: After a save
- **WHEN** the operator saves a value that was marked
- **THEN** the time-series state is read again shortly after, and the mark is gone once the time series holds the saved value

### Requirement: Instances of an attribute
For an attribute with several instances, the Data explorer SHALL show each instance's dataset after the attribute's name, as `name[dataset]`, and SHALL let the operator edit each instance's value in place and delete one instance alone, after confirmation, keeping the others. Adding a sub-attribute to an instance SHALL add it to that instance only, and the raw editor SHALL keep an instance's dataset.

#### Scenario: Datasets shown
- **WHEN** an attribute has a default instance and one with dataset `urn:ngsi-ld:Dataset:live`
- **THEN** the default instance's line shows the name alone and the other one `name[live]`, the dataset in its short form

#### Scenario: A lone default instance
- **WHEN** an attribute has one instance and no dataset
- **THEN** its line shows no dataset

#### Scenario: One instance edited
- **WHEN** the operator edits the value of the instance of one dataset
- **THEN** only that instance changes, and the others keep their values and sub-attributes

#### Scenario: One instance deleted
- **WHEN** the operator deletes the instance `name[dataset]` and confirms
- **THEN** that instance and its sub-attributes are removed, and the attribute's other instances remain

#### Scenario: Sub-attribute of the default instance deleted
- **WHEN** the operator deletes a sub-attribute of the default instance, beside an instance with a dataset that has the same sub-attribute
- **THEN** only the default instance loses it

#### Scenario: Sub-attribute added to an instance
- **WHEN** the operator adds a sub-attribute to an instance with a dataset
- **THEN** it is added to that instance only

#### Scenario: Raw edit of an instance
- **WHEN** the operator changes an instance in the raw editor and keeps its `datasetId`
- **THEN** the change is saved to that instance

### Requirement: Datatype of a value
The Data explorer SHALL show each property value's datatype as the platform reads it: a declared value's `@type`, else `xsd:integer` for a whole number, `xsd:double` for another number, `xsd:boolean`, or `xsd:string`, with a hint for a string that reads as a number. The editor SHALL offer `xsd:string`, `xsd:double`, `xsd:integer`, `xsd:boolean`, `xsd:dateTime` and any other datatype by its IRI, and a changed datatype SHALL write the value in that datatype's form.

#### Scenario: Datatypes shown
- **WHEN** an entity has the plain values `80`, `2.5`, `true` and `"on"`, and a value declared `xsd:double`
- **THEN** their lines show `xsd:integer`, `xsd:double`, `xsd:boolean`, `xsd:string` and `xsd:double`

#### Scenario: A number written as text
- **WHEN** a plain value is the string `"2.7"`
- **THEN** its line shows `xsd:string` with a hint that the platform's check of a double accepts it

#### Scenario: Text made an integer
- **WHEN** the operator changes a text value's datatype to `xsd:integer` and enters `6`
- **THEN** the plain number `6` is saved

#### Scenario: A whole number made a double
- **WHEN** the operator changes a value's datatype to `xsd:double` and enters `6`
- **THEN** `{"@value": 6, "@type": "http://www.w3.org/2001/XMLSchema#double"}` is saved

#### Scenario: A declared value made a string
- **WHEN** the operator changes a value declared `xsd:double` to `xsd:string`
- **THEN** the plain string is saved, without a datatype, and the line shows `xsd:string`

#### Scenario: Another datatype
- **WHEN** the operator picks another datatype and enters its IRI, such as `xsd:token`
- **THEN** the value is saved declared with that datatype, and without an IRI the editor asks for one

#### Scenario: Datatype kept
- **WHEN** the operator edits a value without changing its datatype
- **THEN** the edit is saved as before this change

#### Scenario: A plain whole number given a fraction
- **WHEN** the operator edits a plain `80`, shown as `xsd:integer`, to `80.5` without changing its datatype
- **THEN** the plain number `80.5` is saved

#### Scenario: A live update while editing
- **WHEN** a live update changes the datatype the value is read as while the operator edits it
- **THEN** the editor keeps the datatype it started from, and saving without choosing another one is an edit that keeps the datatype

### Requirement: Form of a value by its datatype
A value whose datatype the operator changed SHALL be written as the platform's typed-literals contract asks writers to: declared, `{"@value": …, "@type": <datatype IRI>}`, for `xsd:double`, `xsd:float`, `xsd:decimal`, `xsd:dateTime` and any other datatype; plain for `xsd:integer` and the other integer datatypes, `xsd:boolean` and `xsd:string`. A number SHALL be written as a JSON number, a boolean as `true` or `false`.

#### Scenario: Declared kinds
- **WHEN** the operator saves `2.5` as `xsd:double`, or `2026-11-15T10:00:00Z` as `xsd:dateTime`
- **THEN** `{"@value": 2.5, "@type": "http://www.w3.org/2001/XMLSchema#double"}`, or `{"@value": "2026-11-15T10:00:00Z", "@type": "http://www.w3.org/2001/XMLSchema#dateTime"}`, is saved

#### Scenario: Plain kinds
- **WHEN** the operator saves `7` as `xsd:integer`, `true` as `xsd:boolean`, or `on` as `xsd:string`
- **THEN** the plain values `7`, `true` and `"on"` are saved

#### Scenario: Not of the datatype's form
- **WHEN** the operator enters `tomorrow` as `xsd:dateTime`, or `yes` as `xsd:boolean`
- **THEN** it is refused as not a value of that datatype

### Requirement: Saving a refused value
When a value is refused as not of its datatype, or by the backend's checks, the editor SHALL keep it, show the reason and warn, and SHALL offer to save it anyway. A value not of its datatype SHALL then be saved declared with that datatype, as entered.

#### Scenario: Not of its datatype
- **WHEN** the operator enters `six` for a value of `xsd:double`
- **THEN** it is refused as not a value of `xsd:double`, nothing is saved, and the warning offers *Save anyway*

#### Scenario: Saved anyway
- **WHEN** the operator then chooses *Save anyway*
- **THEN** `{"@value": "six", "@type": "http://www.w3.org/2001/XMLSchema#double"}` is saved

#### Scenario: Refused by the backend
- **WHEN** the backend refuses an empty value and the operator chooses *Save anyway*
- **THEN** the empty value is saved

### Requirement: Unit of a value
The editor of a property's value SHALL offer its unit beside the value: the units the data model allows, else the units to offer, each shown as code, symbol and name, with the stored unit, *No unit* and *Other code…*. A code the data model doesn't allow, or unknown where it allows none, SHALL be refused with the reason and can be saved anyway. Changing the unit SHALL keep the value.

#### Scenario: The data model's units
- **WHEN** the operator edits a value whose attribute the data model allows `CEL` and `KEL` for
- **THEN** the unit choice offers *No unit*, `CEL · °C · degree Celsius`, `KEL · K · kelvin`, the stored unit and *Other code…*, with the stored unit chosen

#### Scenario: The units to offer
- **WHEN** the data model allows no particular units for the attribute
- **THEN** the unit choice offers the units to offer

#### Scenario: Unit changed
- **WHEN** the operator chooses `KEL` and saves
- **THEN** the editor says that the unit changes to `KEL`, the attribute has that unit, and its value and dataset stay

#### Scenario: Unit removed
- **WHEN** the operator chooses *No unit* and saves
- **THEN** the editor says that the unit is removed, and the attribute has none

#### Scenario: A unit not allowed
- **WHEN** the operator enters `BAR` as another code where the data model allows `CEL` and `KEL`
- **THEN** it is refused, naming the allowed units, and *Save anyway* writes `BAR`

#### Scenario: An unknown code
- **WHEN** the operator enters `XYZ` where the data model allows no particular units
- **THEN** it is refused as no known UN/CEFACT unit code

#### Scenario: No code entered
- **WHEN** the operator chooses *Other code…* and enters nothing
- **THEN** the editor asks for the unit code

### Requirement: Long names shortened in the middle
The Data explorer SHALL show a URN or a prefixed name whose part after `urn:<nid>:` or `prefix:` is longer than 48 characters with that start, its first and last 6 characters and an ellipsis, such as `urn:uaentity:c3Z1PX…01MDE4`. Its tooltip SHALL hold the name in full, and the full IRI behind a prefixed name. Its context menu SHALL offer *Show in full* and then *Abbreviate*, besides the copy actions.

#### Scenario: A long URN
- **WHEN** a relationship's target is `urn:uaentity:` followed by 120 characters
- **THEN** it is shown as `urn:uaentity:`, the first 6 and the last 6 of them with an ellipsis between, on the relationship's line, with the URN in full as its tooltip

#### Scenario: A long prefixed name
- **WHEN** a vocabulary value's short name is `instanceExam:` followed by 120 characters
- **THEN** it is shown shortened the same way, with the prefixed name and the full IRI in its tooltip

#### Scenario: Shorter names unchanged
- **WHEN** a name such as `urn:ngsi-ld:Component:chiller-01-coolant-pump` or `pumps:hasDifferentialPressure` is shown
- **THEN** it is shown as before, with its tooltip and menu as before

#### Scenario: In full and back
- **WHEN** the operator chooses *Show in full* in a shortened name's context menu, and later *Abbreviate*
- **THEN** the name is shown in full in place, then shortened again; copying the identifier, the short name or the full IRI is offered as before

#### Scenario: A long heading
- **WHEN** an entity without a name is shown under the last segment of a long ID
- **THEN** its heading is shortened the same way, with the ID as its tooltip

### Requirement: Relationship targets expanded per instance
For an attribute with several instances, each instance's relationship targets SHALL be expanded in place on their own: expanding a target under one instance SHALL show it under that instance only, and an instance SHALL show only targets of its own. The instances SHALL keep sharing the toggle of their sub-attributes.

#### Scenario: One instance expanded
- **WHEN** a relationship has two instances with different targets and the operator expands the target of the first in place
- **THEN** that target is shown nested under the first instance only, and the second instance's target stays collapsed

#### Scenario: Both expanded, then one collapsed
- **WHEN** the operator expands the targets of both instances, then collapses the first one's
- **THEN** each instance first shows its own target, and then only the second instance shows its target

#### Scenario: Sub-attributes of the instances
- **WHEN** the operator opens the sub-attributes of one instance of a multi-attribute
- **THEN** the sub-attributes of every instance are shown, as before

### Requirement: The entity the address names
The entity the Data explorer's address names, whether a link opened it (from an alert, an incident or a reference) or the operator expanded it in the list, SHALL be marked so that it stands out among the results without relying on colour alone. When a link opens the explorer at it, it SHALL be in view once the results are shown, the entity at the top or the attribute line the link names in the middle, and SHALL be brought back while content loading above moves it, until the operator scrolls.

#### Scenario: Marked as selected
- **WHEN** the operator opens an alert's resource in the Data explorer
- **THEN** that entity, and no other, is framed, its header tinted and labelled *Selected*

#### Scenario: Expanded in the list
- **WHEN** the operator expands another entity in the list
- **THEN** that entity is marked and the one marked before is not, and the explorer brings nothing into view on its own beyond what expanding an entity already does

#### Scenario: Arrival without motion
- **WHEN** the operator's system asks for reduced motion
- **THEN** the mark is shown without the pulse that otherwise marks its arrival

#### Scenario: In view over the kept position
- **WHEN** the operator scrolled down a long list in the explorer, opens another area, and there opens an entity in the Data explorer through a link
- **THEN** the opened entity is in view, rather than the scroll position the explorer kept

#### Scenario: Content loading above
- **WHEN** results above the opened entity load after it was brought into view and move it
- **THEN** it is brought into view again

#### Scenario: The operator scrolls
- **WHEN** the operator scrolls after the entity was brought into view
- **THEN** the explorer does not move the page any more on its own
