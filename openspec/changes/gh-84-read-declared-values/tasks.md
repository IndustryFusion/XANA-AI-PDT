# Tasks

## 1. Tests first

- [x] 1.1 Backend unit tests for the reading of D2 -- a value object with `type` and with `@type`, a number string under a numeric datatype, a boolean string, a plain value, an IRI reference, a language map, a serial-number string that stays a string; verify they fail before the change
  - `backend/agent/tests/test_literals.py`, 18 cases. Before the change the module does not exist and collection fails.
- [x] 1.2 Extend the workflow tests with a declared double, as a number and as a number string, in the fake context; verify the scenarios of *Declared values in observations* fail before the change
  - `agent/tests/test_workflow.py`: `test_a_declared_double_is_a_signal_with_its_unit` (number and number string); both fail before the change.
- [x] 1.3 Extend the explorer broker tests: local range, comparison and pattern on declared values; text refused and a number accepted for a declared double; the declared value sent on an edit (D3); verify the scenarios of the explorer API's *Declared values* and *Edits of declared values* fail before the change
  - `tests/test_explorer_broker.py`: 8 query cases, text refused, the declared value sent, a plain edit. Before the change all declared cases fail; the plain ones pass.
- [x] 1.4 Extend the event tests with notifications in the compacted form the broker sends -- `{"type": …double, "@value": 42.5}` and `{"type": …double, "@value": "42.5"}` -- next to the expanded form tested today; verify they pass before and after the change
  - `tests/test_events.py`: three forms. The compacted and expanded numbers pass before and after; the number string now reads `alarmLevel=3.0` (a double) where it read `3`, the one visible change.
- [x] 1.5 Frontend unit tests for the explorer's value helpers and change detection with declared values, and a rendering and in-place edit test of a declared double; verify the scenarios of the Data explorer's *Declared values* fail before the change
  - `frontend/tests/explorer/declaredValues.test.jsx`, 16 tests: the reading, display (also a number string shown as a number), editable value and input, change detection. 15 fail before the change.

## 2. Backend

- [x] 2.1 Add the reading of D2 to the agent package and use it in the agent's attribute value, facts and signals; verify tasks 1.1 and 1.2 pass
  - `xana_agent/literals.py` (`literal`, `datatype`, `declared`); used by `attribute_value` (so `facts`, `entity_name`) and `numeric_attributes`.
- [x] 2.2 Use it in local query evaluation and in the edit check (D4), and send the declared value on an edit (D3); verify task 1.3 passes
  - `query._plain`; `broker._check_value` compares plain values; `broker._keep_datatype` sends a plain number declared with the stored datatype, in `_merge_fragment` and `_merged_instance`.
- [x] 2.3 Let the event trigger use it instead of its own unwrapping; verify task 1.4 passes
  - `events/worker.py` reads value objects through `literal`; its traversal of expanded and full-IRI forms is unchanged.
- [x] 2.4 Run the backend unit suites and lint; verify they pass
  - 1213 passed, 509 skipped (real-broker tests without a broker); `ruff check .` passes.

## 3. Data explorer

- [x] 3.1 Add the reading of D2 beside the explorer's value helpers and use it for display, the editable value, input parsing and change detection; send the declared value on an in-place edit (D3); verify task 1.5 passes
  - `attributes.js`: `literalOf`, `isValueObject`; used by `editableValue` and `sameValue`, and by `AttributeValue.jsx` for display. `parseInput` needs no change: the editor now gets the plain number.
  - D3 is done by the backend: the Data explorer sends the plain number, and `_keep_datatype` declares it with the stored datatype, which covers every client of the explorer API.
- [x] 3.2 Run the frontend unit suite and lint; verify they pass
  - vitest: 792 passed, 5 skipped; `eslint .` passes.

## 4. Against a real broker

- [x] 4.1 Extend the real-broker explorer and live-update tests to round-trip a declared double through GET, an in-place edit and a notification; record what the broker's own `q` gives for `temperature>40` on a declared `"42.5"` (Risks); verify the tests pass in their workflow and report the `q` result in the Pull Request
  - `test_explorer_real.py`: a declared double round-trips (read, local range, text refused, edit keeps the datatype); the broker's own `q` is recorded under the marker `GH84-BROKER-Q`. `test_live_updates_real.py`: a declared value arrives as its value.
  - Backend workflow, run 43501983887 on `69a407a`: the real-broker step passed, 141 tests. The broker's own `q` `temp>40` matches a declared `42.5` (status 200), measured on `scorpiobroker/all-in-one-runner:java-latest`, the image of that step.
  - Found here: the broker's merge fails on a value object (500, PostgreSQL 22023), so declared edits are written as the whole attribute (design, D3).
- [x] 4.2 Extend the e2e explorer and live specs with a declared double shown, edited and updated live; verify they pass
  - `e2e/backend/explorer.spec.js`: a declared double shown, edited, the datatype checked through the API, text refused; collected by the `backend` project.
  - `live.spec.js` is not extended: the live path is covered by `test_live_updates_real.py` (a declared value arriving) and the change-detection unit tests.
  - The same run: the backend e2e suite passed, 31 tests, the new one included.
  - Found here: the in-place editor parsed the input against the raw value object and sent `80` as text; fixed, with a component test in `tests/explorer/explorer.test.jsx`.

## 5. Documentation

- [x] 5.1 Say in architecture.md, *Data Layer*, that the context broker's property values may be JSON-LD value objects (`@value` with a datatype), that XANA reads them as their values and keeps the datatype on an edit, and that the time-series layout keeps a value's text and type separately; verify by reading the section against this change's requirements
  - A *Declared values* paragraph under the Data Layer table.

## 6. Verification

- [x] 6.1 Check every scenario of the three delta specifications against the implementation and report the result per scenario in the Pull Request
  - Reported per scenario in the Pull Request.
