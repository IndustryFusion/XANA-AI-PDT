# Tasks

## 1. Reading together

- [x] 1.1 Read again on its own every ID of a request for several that fails or doesn't answer in time, and every ID its answer leaves out, the single reads together (D1, D2); verify with unit tests of the backend data source ("A level of a tree", "Reading together fails", "An entity the broker refuses") and end-to-end tests against the real backend and broker ("Reading together fails", "An entity the broker refuses")
  - `frontend/tests/data/backendSource.test.js`: *a request for many that fails or does not answer in time fails no caller its single read would not*; *an entity the broker refuses among others gets the reason of the broker, as when read alone*; *entities asked for in the same task are read in one request; one alone by its own* (the one left out read on its own); *an entity the answer for many latest states leaves out has no states, as when read alone*; *attribute states asked for together are read in one request, and a failure reaches every caller* (only through the failing single reads); *an answer for many that is no object of answers is no answer: each is read on its own*; *the reads again on their own go at most six at once*; *a refusal of the whole request reaches every caller without reading each again*. The first five fail on `main`, the last three on 8ffc450.
  - `frontend/e2e/backend/explorer.spec.js`, against the real backend and broker: *a level whose request for many fails still loads, each entity read on its own* (the request for many aborted); *an ID the broker refuses among others gets the reason of the broker, as when read alone* (the data source of the page, an ID that is not a URI).

## 2. Checks

- [x] 2.1 Run the frontend lint, unit tests, build, bundle check and end-to-end tests; measure the coverage of the changed code; verify all pass and the changed lines' coverage is above 80 %
  - eslint; 1035 unit tests; the build; the bundle check; 188 end-to-end tests on the mock (2 skipped as on `main`). Line coverage of `frontend/src/data/sources/backend/entities.js` 100 %. The end-to-end tests against the real broker run in the integration job.
