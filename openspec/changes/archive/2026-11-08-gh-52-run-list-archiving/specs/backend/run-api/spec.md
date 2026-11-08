# Spec Delta

## REMOVED Requirements

### Requirement: Finished runs stay until archived
**Reason**: Replaced by "Automatic archiving", which archives finished runs after a delay, as #52 asks.
**Migration**: Set `AUTO_ARCHIVE_AFTER_S=0` to keep finished runs until an operator archives them.

## ADDED Requirements

### Requirement: Automatic archiving
A finished run (`completed`, `failed`, `stopped` or `mb_closed`) whose last change is `AUTO_ARCHIVE_AFTER_S` seconds old or older SHALL be archived as an operator archive would, unless its close has not yet reached the machine builder.

#### Scenario: Finished run after the delay
- **WHEN** a `completed`, `failed`, `stopped` or `mb_closed` run has not changed for `AUTO_ARCHIVE_AFTER_S` seconds
- **THEN** it is no longer listed as active, and the incident history holds it with its full record, as after an operator archive

#### Scenario: Before the delay
- **WHEN** a finished run changed less than `AUTO_ARCHIVE_AFTER_S` seconds ago
- **THEN** it stays listed

#### Scenario: Waiting runs
- **WHEN** a run is `running`, waits for the operator, or waits for the machine builder, however long ago it changed
- **THEN** it is not archived automatically

#### Scenario: Pending close
- **WHEN** a stopped run's close has not yet reached the machine builder
- **THEN** it is not archived automatically, and once the close has gone out the delay counts from that change

#### Scenario: Turned off
- **WHEN** `AUTO_ARCHIVE_AFTER_S` is `0`
- **THEN** no run is archived automatically

#### Scenario: After a restart
- **WHEN** the backend restarts while a finished run is part way through its delay
- **THEN** it is archived when the delay since its last change has passed, not later and not at once

#### Scenario: Changed or archived meanwhile
- **WHEN** an operator reopens or archives a run at the moment it becomes due
- **THEN** a reopened run stays active, and a run is archived once, with one incident record

#### Scenario: Memory database unavailable
- **WHEN** the incident can't be written
- **THEN** the run stays listed, and it is archived on a later attempt

### Requirement: Machine builder in the run list
The list of active runs SHALL give each escalated run's machine builder, with ID and name.

#### Scenario: Escalated run
- **WHEN** a run has been escalated
- **THEN** its entry in the list has the machine builder's ID and name

#### Scenario: Not escalated
- **WHEN** a run has not been escalated
- **THEN** its entry has no machine builder
