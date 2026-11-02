# Spec Delta

## Purpose

Lets operators see which alerts are active in the plant, narrow them down, act on them, and move from an alert to the affected machine and its incidents.

## ADDED Requirements

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
The list SHALL show severity, status, resource as an entity reference, event, text, service and age for each alert, and refresh automatically at an interval the operator can choose or switch off.

#### Scenario: Automatic refresh
- **WHEN** a new alert is raised while the list is shown and automatic refresh is on
- **THEN** it appears at the next refresh without losing the current filter or selection

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
From an alert the operator SHALL be able to open the affected entity in the Data explorer, show its active incidents or history, and start a new incident prefilled with the resource.

#### Scenario: Start an incident from an alert
- **WHEN** the operator starts a new incident from an alert
- **THEN** the new-incident form opens with the alert's resource as machine and the alert text proposed as issue
