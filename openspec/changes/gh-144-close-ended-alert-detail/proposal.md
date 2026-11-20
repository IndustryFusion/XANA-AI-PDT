# Proposal

Issue: #144

## Why

An alert's detail stays open after the alert has ended (#144). The list refreshes automatically, so an alert that is cleared or closed drops out of the default list at the next refresh, but the detail beside it keeps showing the alert as it was when it was opened, still open and with the actions of an open alert. The detail is read once and read again only by *Refresh now* or after an action. Closing the alert from its own detail has the same result: the row goes, the detail stays.

The approved spec doesn't say what the detail does while it is shown: *Alert detail* covers selecting an alert, and the automatic refresh of *Alert list* covers only the list.

## What Changes

- The open alert's detail follows the list's automatic refresh, at the interval the operator chose, and is not refreshed automatically when that is off.
- When the alert shown ends while it is shown, that is, it is closed (also by a clear), expires or is deleted, the detail closes and the list is shown with the filter kept. The address stops naming the alert, and going back does not reopen it.
- The detail stays open for an alert that had already ended when it was opened, and under a status filter that lists its new status, where the alert stays in the list; it closes once the filter no longer lists it. Shelving, which keeps an alert's detail useful for unshelving, does not close it.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `operator-ui/alerts`: *Alert detail* (it follows the automatic refresh and closes when its alert ends).

## Out of Scope

- Closing the detail for other reasons an alert leaves the list: shelving, a severity or text that no longer matches the filter, or a list cut at its limit.
- Notifications pushed from Alerta; the detail keeps reading the alert at the list's interval.
- Backend changes.

## Impact

Frontend only: the Alerts area's detail and view, and their unit and end-to-end tests. Affected section of architecture.md: none; the Alerts row of *Frontend* already covers the detail.
