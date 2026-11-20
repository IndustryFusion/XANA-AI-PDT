## MODIFIED Requirements

### Requirement: Alert detail
Selecting an alert SHALL show all its attributes and its history of status changes and notes, and update the URL to that alert. The detail SHALL follow the list's automatic refresh. When the alert shown ends while it is shown, that is, it is closed, expires or is deleted, the detail SHALL close and the list be shown with the filter kept, unless the status filter lists its new status.

#### Scenario: Open detail
- **WHEN** the operator selects an alert
- **THEN** the detail shows its attributes and the ordered history of changes, and the URL identifies the alert

#### Scenario: Detail follows the refresh
- **WHEN** an alert's detail is shown, automatic refresh is on and the alert changes elsewhere
- **THEN** the detail shows the change at the next refresh

#### Scenario: Alert ends while shown
- **WHEN** an alert's detail is shown and the alert is closed, by the operator or by a clear, expires or is deleted, under a status filter that does not list its new status
- **THEN** the detail closes once that is read, the list is shown with the filter kept, the URL no longer names the alert, going back does not reopen it, and keyboard focus that was in the detail moves to the list

#### Scenario: Already ended
- **WHEN** the operator opens the detail of an alert that has already ended, from a link or a list of closed alerts
- **THEN** the detail stays open

#### Scenario: Filter lists the new status
- **WHEN** the alert shown is closed under a status filter that lists closed alerts, such as *Closed* or *All*
- **THEN** the detail stays open and shows the alert as closed, with the actions it now allows

#### Scenario: Filter no longer lists the new status
- **WHEN** a detail stays open as the filter lists its alert's new status, and the operator then chooses a status filter that does not
- **THEN** the detail closes at the next read

#### Scenario: Shelved from the detail
- **WHEN** the operator shelves the alert shown under a filter without shelved alerts
- **THEN** the detail stays open and offers to unshelve it
