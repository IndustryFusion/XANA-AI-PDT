# Tasks

## 1. Backend

- [x] 1.1 Add the search and its endpoint (D1, D2); verify with backend tests for every scenario of *Referring entities* of `backend/explorer-api`, and with a test against a real broker (full names with dots, a sub-attribute of one dataset instance, a property's IRI)

## 2. Frontend

- [x] 2.1 Add the operation to the data interface and both sources, with its recording and its documentation; verify with the interface and shape tests
- [x] 2.2 Add the list to the entity's node and keep it out of expanding all (D3); verify with component tests for every scenario of *Referring entities* of `operator-ui/data-explorer`
- [x] 2.3 Verify end to end: in the browser on the mock source (the list, further up, opened at the attribute) and on the backend source against a real broker

## 3. Documents and checks

- [x] 3.1 Name the operation in architecture.md's tables of UI areas and endpoints; verify by reading them against the delta
- [x] 3.2 Run the linters, the tests, the production build and the accessibility and layout end-to-end tests, and measure the coverage of the changed code; verify all pass and it is above 80 %
