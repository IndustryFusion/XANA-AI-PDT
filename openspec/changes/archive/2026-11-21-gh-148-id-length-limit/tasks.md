# Tasks

## 1. The bound

- [x] 1.1 Bound each ID of the endpoints for many entities to 2,048 characters (D1); verify with backend tests against the fake broker ("An ID too long", "Too many IDs") and against the real broker ("An ID too long")
  - `backend/tests/test_explorer_broker.py`: *an id longer than allowed is refused before the broker* (an ID at the bound accepted by both endpoints; one character more refused with 422 by both, with no broker request; fails on `main`); *more ids than allowed at once are refused* (unchanged).
  - `backend/tests/test_explorer_real.py`: *an id longer than allowed is refused and the others still read* (against the real broker, in the integration job).

## 2. Checks

- [x] 2.1 Run the backend's ruff checks and tests and measure the coverage of the changed code; verify all pass and the changed lines' coverage is above 80 %
  - ruff check and format; 1,399 backend tests pass; the four health tests that expect unreachable services fail on this machine also on `main` (local services answer there) and pass in CI. The changed lines are the model of the IDs, run by every request of both endpoints: 100 %.
