# Proposal

Issue: #52

## Why

Finished runs stay in the active list until an operator archives each one (`gh-31-health-and-settings` dropped automatic archiving). With runs started by machine events (#30) the list grows, and it has no way to see a run's machine builder, to narrow it by typing, or to archive without opening each run.

## What Changes

- **Automatic archiving.** A finished run (`completed`, `failed`, `stopped`, or `mb_closed`) with no change for `AUTO_ARCHIVE_AFTER_S` seconds, 3600 by default, is archived as an operator archive would. `0` turns it off. A run with a pending close, and any run waiting for the operator or the machine builder, is never archived automatically. The time counts from the run's last stored change, so a restart neither resets nor skips it.
- **Active list.** Each escalated run's row shows its machine builder. A free-text filter narrows the list by machine. Each finished row has an archive action, with confirmation and the same rules and refusals as the archive in the run view.
- The run list from the backend carries the machine builder of an escalated run.
- The chart passes `AUTO_ARCHIVE_AFTER_S`.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `backend/run-api`: Automatic archiving replaces "Finished runs stay until archived"; the run list carries the machine builder.
- `backend/service-runtime`: The `AUTO_ARCHIVE_AFTER_S` setting.
- `operator-ui/active-incidents`: Builder per row, free-text machine filter, archive per row.
- `deployment/kubernetes`: The chart passes the setting.

## Impact

- `backend/`: `app/runs/manager.py`, `app/runs/model.py`, `app/config.py`, `app/main.py`, the incident store, tests; `.env.example`, `README.md`.
- `frontend/`: `src/features/incidents/ActiveIncidents.jsx`, both data sources, `docs/data-interface.md`, tests.
- `helm/`: the backend configuration.
- `architecture.md`: the run lifecycle and the configuration table.
- No database change.

## Out of Scope

- Archiving runs that wait for anyone, or deleting incidents.
- Marking in the history which incidents were archived automatically: the issue doesn't ask for it, and it would need a new column. It can be added later.
- Changing what an operator archive does or allows.
- Sorting or grouping the list.
