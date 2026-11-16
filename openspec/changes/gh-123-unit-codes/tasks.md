# Tasks

## 1. Backend

- [x] 1.1 Answer `units` with the hints, from `sh:in` on `ngsi-ld:unitCode` (D1); verify with backend tests for allowed units, a shape with only units, none, a failing units query, and the query's safety
  - `backend/tests/test_ontology.py`: *the units a shape allows come with the hints* (sorted, each once, and a shape with only units), *enum values are unique and sorted* (`units: []` without a rule), *a failing units query leaves the hints as they were*, *the units query names the attribute and parses*, and the existing hostile-input tests, which cover every query the hints send.
- [x] 1.2 Add `/api/shacl/units` with the knowledge's units, else the built-in list (D2); verify with backend tests for both sources and each code once
  - *units from the knowledge or the built-in list*: the knowledge's units sorted by code, else the built-in ones, each code once.
- [x] 1.3 Clear a unit given as `null` by writing the attribute whole (D3); verify with backend tests for an attribute, one instance and a path, with the value and the rest kept
  - `backend/tests/test_explorer_broker.py`: *a unit is set and cleared and the rest stays* (cleared through the attribute write) and *the unit of one instance and at a path is cleared alone*.

## 2. Data explorer

- [x] 2.1 Offer the unit in the value editor (D4); verify with unit tests that the data model's units, the stored one, *No unit* and *Other code…* are offered, and that a change and a removal are saved with the value kept
  - `frontend/tests/explorer/explorer.test.jsx`: *the unit is chosen beside the value: the data model's units, with their symbols and names, or none* (the options, a change to `KEL` with the dataset kept, and a removal).
- [x] 2.2 Refuse a unit not allowed or unknown, and save it anyway; verify with unit tests, including an empty other code
  - *a unit the data model doesn't allow, or no known code, is refused, and can be saved anyway* (an empty other code, `BAR` not allowed and saved anyway, `XYZ` unknown).
- [x] 2.3 Serve `getUnits` and `units` in both data sources, documented; verify with the data-source and shape tests on recorded backend answers
  - `tests/data/backendShapes.test.js` on the recorded `GET /api/shacl/units` and hints with `units`, `tests/data/backendSource.test.js` for the operations served, and the interface documentation test.
- [x] 2.4 Keep the editor's small controls' text whole; verify on the local platform that the datatype and unit choices show their text whole, and with the layout test that the editor's controls stay level
  - On a local IFF platform, the value editor of a pump's temperature showed `xsd:double` and `No unit` whole in its selects; the end-to-end layout test *explorer value editor: buttons are level with the inputs next to them* passes.

## 3. Checks

- [x] 3.1 Run the backend and frontend suites, the build, the bundle check and the end-to-end tests; verify they pass
  - Backend: ruff, the tests and the agent tests. Frontend: eslint, the unit tests, the build, the bundle check and 173 end-to-end tests.
- [x] 3.2 On the local platform, change an attribute's unit and remove it; verify the broker holds the unit, then none, with the value kept
  - On a local IFF platform's broker, through the backend: a value of 21.5 with `CEL` was set to 294.6 with `KEL`, then the unit was cleared; the broker held `KEL`, then no unit, with the value kept.
