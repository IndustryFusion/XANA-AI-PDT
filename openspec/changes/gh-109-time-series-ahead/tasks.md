# Tasks

## 1. Explorer API

- [ ] 1.1 Read the latest state per instance with the `(attributeId, datasetId)` keyset (D1); verify with backend tests that a deleted default instance and a present other instance are listed apart, and that an instance past a full page of another instance's rows is still listed, failing with the attribute-only keyset
- [ ] 1.2 Keep the attribute-level state the latest row of any instance; verify with the existing latest-state test, adjusted to the new field

## 2. Data explorer

- [ ] 2.1 Compare each instance with its own dataset as instants (D2); verify with unit tests for a newer value, a deletion, the same time in another notation, a missing time, another instance's deletion, and an instance the time series holds no row for
- [ ] 2.2 Show the mark beside the value and the value faint (D3); verify with unit tests that a newer value and a deletion show a focusable mark labelled with its text, that the line is marked faint, that nothing is marked while the time series holds the value shown, and that a live update with a value as recent as the time series removes the mark
- [ ] 2.3 Read the state again after a save (D4); verify with a unit test that a save leads to a second read of the state
- [ ] 2.4 Extend the data-source contract and the mock source with `datasets`; verify with the data-source shape tests

## 3. Checks

- [ ] 3.1 Run the backend lint and tests, and the frontend lint, unit tests, build, bundle check and end-to-end tests; verify they pass
- [ ] 3.2 On the local platform, write a value with an older observation time to an attribute, and check that the explorer marks it, and that an attribute whose default instance is deleted while another instance is present is not marked
