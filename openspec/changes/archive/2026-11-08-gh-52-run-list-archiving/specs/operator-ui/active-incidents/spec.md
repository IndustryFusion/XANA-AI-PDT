# Spec Delta

## MODIFIED Requirements

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

## ADDED Requirements

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
