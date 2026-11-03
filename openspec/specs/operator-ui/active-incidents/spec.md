# operator-ui/active-incidents Specification

## Purpose
Lets operators see every open diagnostic run at a glance and start a new analysis for a machine and an issue.

## Requirements

### Requirement: Open runs list
The Active incidents area SHALL list all open runs with machine, issue, status, incident number when assigned, and time since start, newest first.

#### Scenario: Runs present
- **WHEN** the operator opens the Active incidents area and open runs exist
- **THEN** each run is listed with machine, issue, a status label and its age, newest first

#### Scenario: No open runs
- **WHEN** there are no open runs
- **THEN** an empty state says so and offers to start a new analysis

#### Scenario: List stays current
- **WHEN** a run changes state or a new run is started while the list is shown
- **THEN** the list reflects the change without a reload

### Requirement: Select a run
Selecting a run SHALL show it in the run view next to the list and update the URL to that run.

#### Scenario: Select from the list
- **WHEN** the operator selects a run in the list
- **THEN** the run view shows that run, the run is marked as selected, and the URL identifies the run

#### Scenario: Unknown run
- **WHEN** the URL names a run that does not exist or was archived
- **THEN** the run view states that the run is not active and links to the incident history

### Requirement: Filter by machine
The list SHALL be filterable by machine, and opening the area with a machine in the URL SHALL apply that filter.

#### Scenario: Filter from an entity reference
- **WHEN** the operator chooses "show active incidents" on an entity reference
- **THEN** the list shows only open runs for that machine and names the active filter with a way to clear it

### Requirement: Start a new run
The UI SHALL offer a new-incident form with machine ID and issue description; submitting it SHALL start a run and open its run view.

#### Scenario: Start a run
- **WHEN** the operator submits a machine ID and an issue
- **THEN** a new run appears in the list, its run view opens, and its steps begin to stream in

#### Scenario: Prefilled from an entity reference
- **WHEN** the operator starts a new incident from an entity reference
- **THEN** the form opens with the machine ID filled in and focus in the issue field

#### Scenario: Missing input
- **WHEN** the operator submits without a machine ID or without an issue
- **THEN** the form is not submitted and the missing field is identified

#### Scenario: Start fails
- **WHEN** starting the run fails
- **THEN** the form keeps the entered values and shows the reason

#### Scenario: Double submission
- **WHEN** the operator submits the form
- **THEN** the form is disabled until the run has started or the start has failed
