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
The list SHALL be filterable by machine with a free-text field, and opening the area with a machine in the URL SHALL apply that filter.

#### Scenario: Filter from an entity reference
- **WHEN** the operator chooses "show active incidents" on an entity reference
- **THEN** the list shows only open runs for that machine and names the active filter with a way to clear it

#### Scenario: Typed filter
- **WHEN** the operator types part of a machine ID, in any letter case, into the filter
- **THEN** only runs whose machine ID contains it are listed, and clearing the field lists all runs again

#### Scenario: Nothing matches
- **WHEN** no run matches the filter
- **THEN** the list says that no active incidents match the filter, with a way to clear it

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

### Requirement: Where a run came from
Lists and the run view SHALL show a triggered run's source, and treat it like any other run.

#### Scenario: A triggered run
- **WHEN** a run's `source` is `ngsi` or `alert`
- **THEN** the open runs, the dashboard's tile, the run view and the incident history say `Machine event` or `Alert`

#### Scenario: An operator's run
- **WHEN** a run's `source` is `operator`
- **THEN** the run view says `Operator`, and lists show nothing extra

### Requirement: Machine builder per row
Each row of an escalated run SHALL show its machine builder.

#### Scenario: Escalated run
- **WHEN** a listed run has been escalated
- **THEN** its row names the machine builder, or its ID when no name is known

#### Scenario: Not escalated
- **WHEN** a listed run has not been escalated
- **THEN** its row shows no machine builder

### Requirement: Archive from the list
Each finished run's row SHALL offer archiving, after confirmation, with the same rules as archiving in the run view.

#### Scenario: Archive a finished run
- **WHEN** the operator archives a finished run from its row and confirms
- **THEN** the run leaves the list and is in the incident history

#### Scenario: Refused
- **WHEN** the backend refuses the archive, for example because a close has not yet reached the machine builder
- **THEN** the row stays and shows the reason

#### Scenario: Open runs
- **WHEN** a run is not finished
- **THEN** its row offers no archive

#### Scenario: The selected run
- **WHEN** the run shown in the run view is archived from the list, or automatically
- **THEN** the run view says that it is no longer active and links to the incident history
