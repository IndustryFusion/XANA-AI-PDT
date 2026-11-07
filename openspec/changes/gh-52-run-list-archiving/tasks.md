# Tasks

## 1. Backend

- [x] 1.1 Add `AUTO_ARCHIVE_AFTER_S`; verify with config tests for the default, `0`, and invalid values
- [x] 1.2 Add the sweep that archives due finished runs through the operator's archive path; verify with fake-clock tests for each finished state, each waiting state, a pending close, `0`, and before the delay
- [x] 1.3 Concurrency and failure: an operator reopen or archive at the moment a run is due, two sweeps at once, and an incident write failing; verify with tests that fail when the state is not checked again under the run's lock
- [x] 1.4 After a restart, the delay counts from the stored last change; verify against PostgreSQL with a restarted manager
- [x] 1.5 Add `machine_builder` to the run list; verify with API tests for an escalated and a plain run

## 2. Frontend

- [x] 2.1 Show the machine builder per row and a free-text machine filter that the URL filter fills; verify with component tests
- [x] 2.2 Archive per finished row with confirmation and the backend's refusal shown in the row; verify with component tests and the mock source refusing a pending close
- [x] 2.3 The run view of a run archived meanwhile; verify with component tests
- [x] 2.4 Serve the new fields from both data sources and document them in `docs/data-interface.md`; verify with source tests

## 3. Deployment

- [x] 3.1 Pass the setting in the chart; verify with `helm template` and the render check

## 4. Verification with real services

- [ ] 4.1 With a short delay, a completed, a failed and a stopped run are archived and appear in the history with their full record; verify with the backend from source on the local environment
- [ ] 4.2 A run waiting for the machine builder and a run with a pending close are not archived; verify on a real dataspace
- [ ] 4.3 Restart part way through the delay; verify the run is archived on time
- [ ] 4.4 List with builder, filter and row archive in a browser; verify against the backend

## 5. Documents

- [x] 5.1 Update `backend/.env.example`, `backend/README.md`, `helm/README.md` and `architecture.md`; verify by searching for the setting
