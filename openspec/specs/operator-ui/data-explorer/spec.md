# operator-ui/data-explorer Specification

## Purpose
Lets operators inspect and maintain the plant's digital twin: query NGSI-LD entities, follow their relationships, edit attribute values, see how signals changed over time and as the twin was at a past moment, and watch values change live.

## Requirements

### Requirement: Query entities
The Data explorer SHALL let the operator query entities by type, entity ID, ID pattern and attribute filters with a result limit, and keep the query in the URL.

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

### Requirement: Entity view
Selecting an entity SHALL expand it in the result list as a structured document in the entity's own attribute order: one line per attribute with a kind label, name and value, plus units, observation times, sub-attributes (collapsible) and metadata, with a toggle to an editable raw JSON; the URL SHALL identify the expanded entity.

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

### Requirement: Relationship and IRI navigation
Relationship targets and IRI values SHALL be navigable, each offering a context menu to open, copy, start an incident for it, and show its active incidents or history; relationship targets SHALL also expand in place, nested under the attribute.

#### Scenario: Follow a relationship
- **WHEN** the operator selects a relationship target
- **THEN** the target entity opens and the browser back button returns to the previous entity

#### Scenario: Expand a relationship in place
- **WHEN** the operator expands a relationship target
- **THEN** the target entity is shown nested and indented under the attribute, and a target already shown above it in the same tree is marked instead of expanded again

#### Scenario: Context menu on an IRI
- **WHEN** the operator opens the context menu of an IRI value
- **THEN** open, copy, start incident, show active incidents and show history are offered

### Requirement: Edit attributes
The operator SHALL be able to change attribute values in place on the attribute's line, add attributes, and delete attributes, sub-attributes and entities, with suggested values where the data model provides them and confirmation before deleting.

#### Scenario: Change a value with suggestions
- **WHEN** the operator selects the value of an attribute that has suggested values
- **THEN** the value becomes an input in place offering the suggestions, Enter saves and updates the value shown, and Escape cancels

#### Scenario: Rejected change
- **WHEN** a change is rejected
- **THEN** the editor stays open with the entered value and shows the reason

#### Scenario: Delete a sub-attribute
- **WHEN** the operator deletes a sub-attribute and confirms
- **THEN** only that sub-attribute is removed and the attribute remains

### Requirement: Attribute history
For attributes with recorded history the UI SHALL show the values over a selectable time range as a chart for numeric values and as a table for all values. An attribute whose latest recorded state is deleted SHALL say so.

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

### Requirement: Time-shift
The operator SHALL be able to view entity types and entities as they were at a chosen past moment, clearly marked as a historical view, and return to the present.

#### Scenario: View the past
- **WHEN** the operator picks a past moment
- **THEN** types and entities are shown as of that moment, editing is disabled, and a banner names the moment with a way back to the present

### Requirement: Import and bulk delete
The operator SHALL be able to import entities from a file or a URL after a preview, see the result per entity, and delete all entities of selected types after confirmation.

#### Scenario: Import from file
- **WHEN** the operator chooses a JSON file of entities, reviews the preview and confirms
- **THEN** the entities are imported and each entity's result (created, updated or failed with reason) is listed

#### Scenario: Invalid file
- **WHEN** the file is not valid NGSI-LD JSON
- **THEN** the preview explains the problem and import is not offered

#### Scenario: Delete by type
- **WHEN** the operator selects entity types, confirms deletion and the deletion completes
- **THEN** the number of deleted entities per type is shown and the list is refreshed

### Requirement: Live updates
The Data explorer SHALL show attribute changes as they happen when live updates are on, highlight changed values briefly, and indicate whether live updates are working. When they stop working, it SHALL recover by itself once they work again.

#### Scenario: Value changes live
- **WHEN** live updates are on and a shown attribute changes
- **THEN** the new value appears without a reload and is highlighted briefly

#### Scenario: Live updates unavailable
- **WHEN** live updates cannot be delivered
- **THEN** the indicator says so and the explorer keeps working without them

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
