# Tasks

## 1. Lookup

- [x] 1.1 Add `useBuilderNames` beside `useMachineNames` (D1); verify with unit tests that the IDs are deduplicated and sorted into one request, and that nothing is returned while loading or after an error
  - `useBuilderNames` in `app/machineNames.js`. Both lists' tests *the builders are looked up once for the list…* check one call with the deduplicated, sorted machine IDs, and the history test also that there are fewer IDs than rows; a failed lookup returns nothing.

- [x] 1.2 Bound the backend's builder lookup like the name lookups (D4); verify with a backend test that a hanging registry gives the builders within `NAMES_WITHIN_S` and isn't asked again while down
  - `tests/test_ifric.py`, *builders within one time and not asked while down*: 20 machines against a registry that hangs answer within `NAMES_WITHIN_S`, and the next lookup sends no request. It fails without the bound.

## 2. Lists

- [x] 2.1 Name the builder in the open-runs rows (D2); verify with unit tests that an escalated run names its recipient, a run that was not escalated names the registry's builder, and one without a known builder shows none
  - `tests/incidents/activeIncidents.test.jsx`, *an escalated run names its recipient; another run names its machine builder from the registry, or none*.
- [x] 2.2 Name the builder in the incident history (D3); verify with unit tests that a known builder is named and an unknown one shows nothing
  - `tests/history/history.test.jsx`, *each past incident names its machine's builder from the registry, when it knows one*.
- [x] 2.3 Keep the lists usable when the registry fails, and recover; verify with unit tests, for both lists, that a failed lookup shows no builder and the rows otherwise as before, and that the builders appear when the list is opened again and the registry answers
  - Both lists' tests *the builders are looked up once for the list; while the registry fails none are shown, and they appear when the list is opened again*: no builder from the registry during the failure, the rows otherwise as before, and the builders shown after reopening. *While the builders of other machines load, the builders already known stay* (`activeIncidents.test.jsx`) and *a filter change keeps the builders and asks the registry nothing* (`history.test.jsx`).

## 3. Checks

- [x] 3.1 Run the frontend lint, unit tests, build, bundle check and end-to-end tests; verify they pass
  - Frontend: eslint, 912 unit tests, the build, the bundle check and 173 end-to-end tests (2 skipped). The scroll test's viewport is 760 px high, for the four runs with a builder line.
- [x] 3.2 On the local platform, open both lists with a registry that knows a machine's builder; verify each row names it as described
  - On a local IFF platform whose registry names the listed machines' builders, the open-runs list and the incident history named them as described.
