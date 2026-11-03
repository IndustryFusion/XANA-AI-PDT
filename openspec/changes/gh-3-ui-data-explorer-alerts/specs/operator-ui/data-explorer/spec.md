# Spec Delta

## Purpose

Lets operators inspect and maintain the plant's digital twin: query NGSI-LD entities, follow their relationships, edit attribute values, see how signals changed over time and as the twin was at a past moment, and watch values change live.

## ADDED Requirements

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
For attributes with recorded history the UI SHALL show the values over a selectable time range as a chart for numeric values and as a table for all values.

#### Scenario: Numeric history
- **WHEN** the operator opens the history of a numeric attribute and picks a time range
- **THEN** a chart and a table of the values in that range are shown, with the unit

#### Scenario: Empty range
- **WHEN** no value was recorded in the selected range
- **THEN** the history says that there is no data in this time range

#### Scenario: Chart alternative
- **WHEN** the chart is shown
- **THEN** the same values are available in the table, so the information does not depend on seeing the chart

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
The Data explorer SHALL show attribute changes as they happen when live updates are on, highlight changed values briefly, and indicate whether live updates are working.

#### Scenario: Value changes live
- **WHEN** live updates are on and a shown attribute changes
- **THEN** the new value appears without a reload and is highlighted briefly

#### Scenario: Live updates unavailable
- **WHEN** live updates cannot be delivered
- **THEN** the indicator says so and the explorer keeps working without them
