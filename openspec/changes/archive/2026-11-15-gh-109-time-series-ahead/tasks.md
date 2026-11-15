# Tasks

## 1. Explorer API

- [x] 1.1 Read the latest state per instance with the `(attributeId, datasetId)` keyset (D1); verify with backend tests that a deleted default instance and a present other instance are listed apart, and that an instance past a full page of another instance's rows is still listed, failing with the attribute-only keyset
  - `tests/test_explorer_history.py`: *test_status_tells_each_dataset_apart* and *test_status_finds_a_dataset_past_a_full_page_of_another*; the second fails with the attribute-only keyset. The fake PostgREST in `tests/explorer_support.py` evaluates the nested `and(...)` and `gt` it now needs.
- [x] 1.2 Keep the attribute-level state the latest row of any instance; verify with the existing latest-state test, adjusted to the new field
  - *test_status_is_latest_per_attribute* checks the attribute-level `deleted` and `observedAt` as before, beside the new `datasets`.

## 2. Data explorer

- [x] 2.1 Compare each instance with its own dataset as instants (D2); verify with unit tests for a newer value, a deletion, the same time in another notation, a missing time, another instance's deletion, and an instance the time series holds no row for
  - `tests/explorer/explorer.test.jsx`: *compares the instants, whatever their notation, and a deletion wins* and *each instance is compared with its own dataset…*, the latter including an instance with no row.
- [x] 2.2 Show the mark beside the value and the value faint (D3); verify with unit tests that a newer value and a deletion show a focusable mark labelled with its text, that the line is marked faint, that nothing is marked while the time series holds the value shown, and that a live update with a value as recent as the time series removes the mark
  - *a newer value in the time series is marked beside the value, which is shown faint* (a focusable mark labelled with its text), *an attribute the time series records as deleted is marked*, *nothing is marked while the time series holds the value shown*, and *a live update with a value as recent as the time series removes the mark*.
- [x] 2.3 Read the state again after a save (D4); verify with a unit test that a save leads to a second read of the state
  - *after a save the time-series state is read again, so the mark follows the save*: it fails without the re-read, because the read the save triggers at once can come before the time series has recorded the save.
- [x] 2.4 Extend the data-source contract and the mock source with `datasets`; verify with the data-source shape tests
  - The data-source contract accepts `datasets`, and the mock source returns it like the backend; the data tests pass.

## 3. Checks

- [x] 3.1 Run the backend lint and tests, and the frontend lint, unit tests, build, bundle check and end-to-end tests; verify they pass
  - Backend: ruff, 1158 tests and 134 agent tests pass. Frontend: eslint, 899 unit tests, the build, the bundle check and 173 end-to-end tests pass.
- [x] 3.2 On the local platform, write a value with an older observation time to an attribute, and check that the explorer marks it, and that an attribute whose default instance is deleted while another instance is present is not marked
  - On a local IFF platform, a value written with an observation time a day older than the time series' latest was marked and shown faint. An attribute whose default instance is recorded as deleted while its `hasSensor1` instance is present was not marked.
