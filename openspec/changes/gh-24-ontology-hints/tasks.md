# Tasks

## 1. Backend

- [x] 1.1 Add the settings `FUSEKI_URL`, `FUSEKI_DATASET`, `FUSEKI_GRAPH_BASE`; verify with config tests, including an unsafe base, and that `.env.example` lists them
- [x] 1.2 Add escaping of IRIs and literals; verify with parser tests that hostile input cannot change the query's structure
- [x] 1.3 Add `query`, `shapes` and `knowledge`; verify errors come back as data, and updates and `SERVICE` are refused
- [x] 1.4 Add `/api/shacl/hints`; verify enum, class, range, datatype, parent class, none, empty and unavailable, against a real Fuseki

## 2. Frontend

- [x] 2.1 Change `getValueHints` to the new shape in the interface and mock, and serve it from the backend source; verify with interface and source tests
- [x] 2.2 Show allowed ranges in the value editor; verify with a component test

## 3. Local environment and deployment

- [x] 3.1 Add Fuseki under a profile, loaded with sample shapes and knowledge for the sample machines; verify hints through it
- [x] 3.2 Add the settings to the chart; verify with `helm template`

## 4. Verification

- [x] 4.1 The explorer shows hints from a real Fuseki with a loaded dataset; verify in a browser
- [x] 4.2 An empty or stopped Fuseki doesn't break the explorer; verify in a browser
- [x] 4.3 Query input can't change the query; verify with parser tests and a real Fuseki
- [x] 4.4 A graph base other than the default works; verify against a real Fuseki

## 5. Documents

- [x] 5.1 Update `backend/README.md`, `helm/README.md`, `frontend/docs/data-interface.md`, `architecture.md`; verify by searching for each setting

## 6. Integration check

- [ ] 6.1 Run backend and frontend tests, lint and `openspec validate --all --strict`; verify locally and in CI
- [ ] 6.2 Check each scenario in the delta specs and report per scenario in the Pull Request
