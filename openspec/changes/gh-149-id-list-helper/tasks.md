# Tasks

## 1. The helpers

- [x] 1.1 Add `_by_ids` and use it for the endpoints for many entities, the has-attribute filter and the import, with one chunk size (D1); verify with backend tests ("An existing ID with a comma in an import", "An import whose list the broker refuses", "An import the broker refuses to read", "The has-attribute filter with an ID with a comma", "The has-attribute filter with a list the broker refuses", "The has-attribute filter with a list too long", "Parameters the broker refuses", "A single read failing") and the existing tests of *Many entities at once*, *Import* and *Has-attribute filter* unchanged
  - `backend/tests/test_explorer_broker.py`: *import reads an existing id with a comma on its own*; *import whose id list the broker refuses reads each on its own*; *has attribute reads an id with a comma on its own* (these three fail on `main`); *has attribute whose id list the broker refuses is refused with one query*, *has attribute whose id list is too long reads each on its own*, *has attribute with a comma id and attributes the broker refuses is refused* (the last two fail on `main`, where the first already held; the first and the last fail on da4c973); *a single read the broker fails fails the read of many*; *a single read that answers no entity fails the read of many* and *has attribute with attributes the broker refuses is refused not empty* (both fail on e1f69bc); *an import the broker refuses to read is refused and writes nothing*, *a list answer that is no list fails the read of many*, *has attribute leaves out a single read without the selected attributes* (all three fail on 50a1c92).
  - The tests of many entities at once, of the import and of the has-attribute filter pass unchanged.
- [x] 1.2 Add `gather_bounded` and use it for the broker's single reads and the time series (D2); verify with the existing tests of the bounds on concurrent reads unchanged
  - `backend/tests/test_explorer_history.py`: *statuses read the time series a few at a time*, *the bound on time series reads holds across requests*, *a failing time series fails the states of many and stops the rest*, unchanged and passing.

## 2. Checks

- [x] 2.1 Run the backend's ruff checks and tests and measure the coverage of the changed code; verify all pass and the changed lines' coverage is above 80 %
  - ruff check and format; 1,402 backend tests pass; the four health tests that expect unreachable services fail on this machine also on `main` and pass in CI. Coverage: `app/ngsi/bounded.py` 100 %, `_by_ids` every line, `broker.py` 93 %, `history.py` 94 %.
