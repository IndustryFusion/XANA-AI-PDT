## MODIFIED Requirements

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

## ADDED Requirements

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
