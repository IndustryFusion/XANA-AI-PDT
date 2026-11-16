# Tasks

## 1. Backend

- [ ] 1.1 Answer `units` with the hints, from `sh:in` on `ngsi-ld:unitCode` (D1); verify with backend tests for allowed units, a shape with only units, none, a failing units query, and the query's safety
- [ ] 1.2 Add `/api/shacl/units` with the knowledge's units, else the built-in list (D2); verify with backend tests for both sources and each code once
- [ ] 1.3 Clear a unit given as `null` by writing the attribute whole (D3); verify with backend tests for an attribute, one instance and a path, with the value and the rest kept

## 2. Data explorer

- [ ] 2.1 Offer the unit in the value editor (D4); verify with unit tests that the data model's units, the stored one, *No unit* and *Other code…* are offered, and that a change and a removal are saved with the value kept
- [ ] 2.2 Refuse a unit not allowed or unknown, and save it anyway; verify with unit tests, including an empty other code
- [ ] 2.3 Serve `getUnits` and `units` in both data sources, documented; verify with the data-source and shape tests on recorded backend answers
- [ ] 2.4 Keep the editor's small controls' text whole; verify on the local platform that the datatype and unit choices show their text whole, and with the layout test that the editor's controls stay level

## 3. Checks

- [ ] 3.1 Run the backend and frontend suites, the build, the bundle check and the end-to-end tests; verify they pass
- [ ] 3.2 On the local platform, change an attribute's unit and remove it; verify the broker holds the unit, then none, with the value kept
