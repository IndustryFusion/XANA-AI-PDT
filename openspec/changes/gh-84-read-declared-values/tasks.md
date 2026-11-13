# Tasks

## 1. Tests first

- [ ] 1.1 Backend unit tests for the reading of D2 -- a value object with `type` and with `@type`, a number string under a numeric datatype, a boolean string, a plain value, an IRI reference, a language map, a serial-number string that stays a string; verify they fail before the change
- [ ] 1.2 Extend the workflow tests with a declared double, as a number and as a number string, in the fake context; verify the scenarios of *Declared values in observations* fail before the change
- [ ] 1.3 Extend the explorer broker tests: local range, comparison and pattern on declared values; text refused and a number accepted for a declared double; the declared value sent on an edit (D3); verify the scenarios of the explorer API's *Declared values* and *Edits of declared values* fail before the change
- [ ] 1.4 Extend the event tests with notifications in the compacted form the broker sends -- `{"type": …double, "@value": 42.5}` and `{"type": …double, "@value": "42.5"}` -- next to the expanded form tested today; verify they pass before and after the change
- [ ] 1.5 Frontend unit tests for the explorer's value helpers and change detection with declared values, and a rendering and in-place edit test of a declared double; verify the scenarios of the Data explorer's *Declared values* fail before the change

## 2. Backend

- [ ] 2.1 Add the reading of D2 to the agent package and use it in the agent's attribute value, facts and signals; verify tasks 1.1 and 1.2 pass
- [ ] 2.2 Use it in local query evaluation and in the edit check (D4), and send the declared value on an edit (D3); verify task 1.3 passes
- [ ] 2.3 Let the event trigger use it instead of its own unwrapping; verify task 1.4 passes
- [ ] 2.4 Run the backend unit suites and lint; verify they pass

## 3. Data explorer

- [ ] 3.1 Add the reading of D2 beside the explorer's value helpers and use it for display, the editable value, input parsing and change detection; send the declared value on an in-place edit (D3); verify task 1.5 passes
- [ ] 3.2 Run the frontend unit suite and lint; verify they pass

## 4. Against a real broker

- [ ] 4.1 Extend the real-broker explorer and live-update tests to round-trip a declared double through GET, an in-place edit and a notification; record what the broker's own `q` gives for `temperature>40` on a declared `"42.5"` (Risks); verify the tests pass in their workflow and report the `q` result in the Pull Request
- [ ] 4.2 Extend the e2e explorer and live specs with a declared double shown, edited and updated live; verify they pass

## 5. Documentation

- [ ] 5.1 Say in architecture.md, *Data Layer*, that the context broker's property values may be JSON-LD value objects (`@value` with a datatype), that XANA reads them as their values and keeps the datatype on an edit, and that the time-series layout keeps a value's text and type separately; verify by reading the section against this change's requirements

## 6. Verification

- [ ] 6.1 Check every scenario of the three delta specifications against the implementation and report the result per scenario in the Pull Request
