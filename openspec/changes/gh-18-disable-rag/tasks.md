# Tasks

## 1. Knowledge base setting

- [ ] 1.1 Add the `VITE_KNOWLEDGE_BASE` setting, off by default, and document it in `frontend/README.md`; verify a default build reports it off, and a build with it on reports it on
- [ ] 1.2 Hide the Knowledge Base screen and its navigation entry in the System area when off; verify with a component test in both states
- [ ] 1.3 Remove the `knowledgeBase` area from the data layer when off, on both data sources; verify with data-interface tests in both states
- [ ] 1.4 Remove the `retrieve_documents` step and `manuals` content from mock scenarios when off; verify scenario tests in both states, and that `retrieve_similar_incidents` remains

## 2. Tests

- [ ] 2.1 Update `frontend/tests/data/interface.test.js`, `backendSource.test.js`, `system.test.js`, `runEngine.test.js` and `tests/incidents/runView.test.jsx` for the default; verify they pass
- [ ] 2.2 Run `tests/system/knowledgeBase.test.jsx` and `tests/data/knowledgeBase.test.js` with the setting on; verify they pass
- [ ] 2.3 Update `frontend/e2e/system.spec.js`, `accessibility.spec.js` and `layout.spec.js`, keeping the knowledge base checks for a build with the setting on; verify end-to-end tests pass on the default build
- [ ] 2.4 Add a test that a backend build shows no mock documents; verify it fails if the area is left in place

## 3. Documents

- [ ] 3.1 Update `frontend/docs/data-interface.md` to mark the knowledge base as an optional area, off by default; verify by reading it against `frontend/src/data/interface.js`
- [ ] 3.2 Mark retrieval in `architecture.md` as not part of the current system; verify each section named in the proposal says so
- [ ] 3.3 Correct the machine builder lookup in `architecture.md`, and remove `IFRIC_REFRESH_TOKEN` if present; verify by searching for `company/products` and `IFRIC_REFRESH_TOKEN`

## 4. Integration check

- [ ] 4.1 Run all frontend tests, lint and `openspec validate --all --strict`; verify they pass locally and in CI
- [ ] 4.2 Confirm the scope in the proposal: no changes to agent memory lookup, the `documents` sharing category or `backend/`; verify with `git diff --stat` against `main`
- [ ] 4.3 Follow the documented re-enable step; verify the screen, its operations and the mock step return
- [ ] 4.4 Check each scenario in the delta specs and report the result per scenario in the Pull Request; verify the report covers every scenario

## Workflow follow-up

- After merge, run `/opsx:archive gh-18-disable-rag` in a follow-up Pull Request, with `Closes #18` in its description.
