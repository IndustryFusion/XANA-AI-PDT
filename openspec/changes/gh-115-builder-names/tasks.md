# Tasks

## 1. Lookup

- [ ] 1.1 Add `useBuilderNames` beside `useMachineNames` (D1); verify with unit tests that the IDs are deduplicated and sorted into one request, and that nothing is returned while loading or after an error

- [ ] 1.2 Bound the backend's builder lookup like the name lookups (D4); verify with a backend test that a hanging registry gives the builders within `NAMES_WITHIN_S` and isn't asked again while down

## 2. Lists

- [ ] 2.1 Name the builder in the open-runs rows (D2); verify with unit tests that an escalated run names its recipient, a run that was not escalated names the registry's builder, and one without a known builder shows none
- [ ] 2.2 Name the builder in the incident history (D3); verify with unit tests that a known builder is named and an unknown one shows nothing
- [ ] 2.3 Keep the lists usable when the registry fails, and recover; verify with unit tests, for both lists, that a failed lookup shows no builder and the rows otherwise as before, and that the builders appear when the list is opened again and the registry answers

## 3. Checks

- [ ] 3.1 Run the frontend lint, unit tests, build, bundle check and end-to-end tests; verify they pass
- [ ] 3.2 On the local platform, open both lists with a registry that knows a machine's builder; verify each row names it as described
