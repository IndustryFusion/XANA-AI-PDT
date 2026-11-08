# Design

## Context

`gh-31-health-and-settings` dropped automatic archiving so that a run that failed with nobody watching stays in sight, and left it to be added later "without loss". This change adds it, as #52 asks. `backend/run-api` has the requirement "Finished runs stay until archived", which this change removes. There is no conflict with `architecture.md`.

## Decisions

### What counts as finished

`completed`, `failed`, `stopped` and `mb_closed`, the states in which an operator may archive. The issue lists the first three; a conversation closed by the machine builder is finished in the same way, and a run closed from this side is `stopped` already. A run whose close has not yet reached the machine builder (`close_pending`) is excluded, as an operator archive refuses it too. Runs in `running`, `awaiting_input`, `awaiting_confirmation` and the conversation states are not finished and are never archived automatically.

Alternative: leave `mb_closed` runs to the operator. The builder ended that conversation, and nothing in the run waits, so there is nothing to keep them for.

### When

A run qualifies once `AUTO_ARCHIVE_AFTER_S` seconds have passed since its last stored change (`updated_at`). A sweep runs every minute, or every `AUTO_ARCHIVE_AFTER_S` if that is shorter, and starts once stored runs are restored, so after a restart a run that had waited 50 minutes is archived 10 minutes later, not 60. `0` turns the sweep off.

Alternative: archive when the list is read. Nobody reading the list would keep the runs, and a read would have side effects.

### Same path as an operator archive

The sweep takes each run's lock and calls the same archive operation, which checks the state again under the lock. So a run that was reopened, sent a message or archived by an operator in the meantime is left alone, and one archived twice is archived once. A failure to write the incident leaves the run in the list, and the next sweep tries again; it is logged without stopping the sweep.

### No mark in the history

An automatic archive writes the same incident record as an operator's, so the history can't tell them apart. The issue asks for the archive "as an operator archive would", and a mark would need a new column in `incidents`.

Alternative: an `archived_by` column shown in the history detail. Useful for audit; it can be added later without losing anything, as `archived_at` and the run's last change are both kept.

### The list

The run summary gets `machine_builder`, `{id, name}` from the escalation, or `null`. The filter is case-insensitive and matches any part of the machine ID; the URL filter from an entity reference stays and fills the same field. The archive per row asks for confirmation and shows the backend's refusal in the row, for instance for a pending close.

Alternative: show the archive action only on runs the backend would accept. The pending close is in the run's data, not in the summary; refusing and saying why keeps one source of truth.

## Risks

- A failed run nobody looked at leaves the list after an hour. It is in the history with its full record, and the delay can be raised or turned off.
