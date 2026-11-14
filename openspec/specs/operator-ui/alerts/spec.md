# operator-ui/alerts Specification

## Purpose
Lets operators see which alerts are active in the plant, narrow them down, act on them, and move from an alert to the affected machine and its incidents.

## Requirements

### Requirement: Severity summary
The Alerts area SHALL show the number of alerts per severity for the current filter, and selecting a severity SHALL filter the list by it.

#### Scenario: Filter by severity from the summary
- **WHEN** the operator selects a severity in the summary
- **THEN** the list shows only alerts of that severity and the summary marks it as selected

### Requirement: Filters
The operator SHALL be able to filter alerts by status, severity, environment, service and free text, with the default showing open and acknowledged alerts, and the filter kept in the URL.

#### Scenario: Default filter
- **WHEN** the operator opens the Alerts area
- **THEN** open and acknowledged alerts are listed, most severe and newest first

#### Scenario: Combine filters
- **WHEN** the operator selects an environment and types text
- **THEN** only alerts matching both are listed and the URL reflects the filter

#### Scenario: No matches
- **WHEN** no alert matches the filter
- **THEN** the list says that no alerts match the current filter

### Requirement: Alert list
The list SHALL show one line per alert with severity, status, the resource by its short name, event, text, service, age and the number of duplicates, and refresh automatically at an interval the operator can choose or switch off. The list SHALL fit its width without scrolling sideways: a cell too long for its column is cut off, with its full text shown on hover, and a narrower list leaves out columns, the service first, then the status, which the detail still shows.

#### Scenario: Automatic refresh
- **WHEN** a new alert is raised while the list is shown and automatic refresh is on
- **THEN** it appears at the next refresh without losing the current filter or selection

#### Scenario: Fits the width
- **WHEN** the list is shown in a window 1280, 1024 or 390 pixels wide, with or without an alert's detail open
- **THEN** the page does not scroll sideways, and each alert takes one line, except a row that shows the reason of a failed action

#### Scenario: Cut-off cells
- **WHEN** an alert's resource, event, text or service is too long for its column
- **THEN** the cell ends with an ellipsis, and hovering over it shows its full text, the resource as its full IRI

#### Scenario: Narrow list
- **WHEN** the list is narrow, in a small window, beside an open detail or on a phone
- **THEN** the service is left out first, then the status, and on a phone only the selection, severity, resource and event remain

#### Scenario: No buttons in a row
- **WHEN** alerts are listed
- **THEN** a row holds only its checkbox and the link to its detail, and its actions are reached through its context menu

#### Scenario: Duplicates
- **WHEN** an alert has been received again as a duplicate
- **THEN** its row shows the number of duplicates, and the column is empty for an alert without duplicates

#### Scenario: Reason of a failed action
- **WHEN** an action failed for an alert in the list
- **THEN** the action's results give the reason for that alert, and wherever the list shows the text, the row shows the reason in full, on more than one line if needed

### Requirement: Alert actions
The operator SHALL be able to acknowledge, unacknowledge, shelve, unshelve, close and reopen alerts, singly or for a selection, with an optional note.

#### Scenario: Bulk acknowledge
- **WHEN** the operator selects several open alerts and acknowledges them
- **THEN** each becomes acknowledged, and the result is reported per alert

#### Scenario: Partial failure
- **WHEN** an action fails for some of the selected alerts
- **THEN** the alerts that failed stay selected with the reason, and the others show their new status

### Requirement: Alert detail
Selecting an alert SHALL show all its attributes and its history of status changes and notes, and update the URL to that alert.

#### Scenario: Open detail
- **WHEN** the operator selects an alert
- **THEN** the detail shows its attributes and the ordered history of changes, and the URL identifies the alert

### Requirement: From an alert to its context
From an alert the operator SHALL be able to open the affected entity in the Data explorer, show its active incidents or history, and start a new incident prefilled with the resource: from the alert row's context menu, opened by a right click on the row or by Shift+F10 or the Menu key on its checkbox or link, from the detail, and directly when one alert is selected. The row's context menu SHALL also copy the resource IRI and the alert ID.

#### Scenario: Start an incident from an alert
- **WHEN** the operator starts a new incident from an alert
- **THEN** the new-incident form opens with the alert's resource as machine and the alert text proposed as issue

#### Scenario: Context menu on an alert row
- **WHEN** the operator opens the context menu of an alert row with a right click or the keyboard
- **THEN** start new incident, open details, open the resource in the Data explorer, show active incidents, show incident history, the actions allowed for that alert, copy resource IRI and copy alert ID are offered

#### Scenario: Start an incident from the selection
- **WHEN** the operator selects a single alert
- **THEN** a start new incident action is offered right away, without opening a menu

### Requirement: IRIs in the alert detail
The alert detail SHALL show the resource as its full IRI with the entity's context menu, and give each IRI in the alert's event, text, value, attributes and history a context menu, opened by a right click or by Shift+F10 or the Menu key. An IRI that names an attribute of the alert's resource, or a sub-attribute after `==>`, SHALL lead to that attribute in the Data explorer. An entity IRI SHALL offer the entity's items, and every IRI SHALL be copyable.

#### Scenario: Go to an attribute
- **WHEN** the operator opens the context menu of an attribute IRI in the alert detail and chooses to go to the attribute
- **THEN** the Data explorer opens the alert's resource with that attribute's line in view and marked

#### Scenario: Go to a sub-attribute
- **WHEN** the alert text names an attribute with a dataset index, then `==>` and a second IRI, and the operator goes to the second IRI
- **THEN** the Data explorer opens the resource with the attribute's sub-attributes expanded and the sub-attribute's line marked

#### Scenario: Entity IRI
- **WHEN** the operator focuses an entity IRI in the alert text and presses Shift+F10
- **THEN** the menu offers going to the entity in the Data explorer, starting a new incident, showing its active incidents and its incident history, and copying the IRI

#### Scenario: Vocabulary term
- **WHEN** the alert text quotes a term of the XML Schema, RDF, RDF Schema or SHACL vocabularies, such as a datatype
- **THEN** it is not taken for an attribute, and its menu only offers copying the IRI

#### Scenario: Text reads the same
- **WHEN** an alert's text holds IRIs
- **THEN** the detail shows the alert's text character for character, with only the IRIs marked as having a menu

### Requirement: Alerts view is kept
The Alerts area SHALL show the same view after the operator leaves it and comes back through the main navigation: the filter, the open alert, the checked rows, the last list and the scroll position. The view SHALL be forgotten when the session ends.

#### Scenario: Back through the navigation
- **WHEN** the operator has a filter, an open alert and checked rows, opens another area and selects Alerts in the navigation
- **THEN** the same filter, open alert and checked rows are shown, and the address is the one the operator left

#### Scenario: Last list at once
- **WHEN** the operator comes back to the Alerts area
- **THEN** the last list is shown right away, at the scroll position it had, and is brought up to date by the next answer

#### Scenario: Session ended
- **WHEN** the session ends and an operator signs in again
- **THEN** the Alerts area opens with the default filter and nothing checked
