# Tasks

## 1. Mock data

- [ ] 1.1 Implement the mock `dataspace` operations (`connect`, `disconnect`, `getPeerCapabilities`, `listCapabilityRequests`, `decideCapabilityRequest`, `setCapabilityPolicy`, `resolveNames`, `resolveBuilders`) with seeded requests and policies; add result shapes; verify data-interface shape tests and behaviour tests for connect errors, decisions and policy changes
- [ ] 1.2 Implement the mock `knowledgeBase` operations with seeded documents per pipeline, sample passages, job progress and a failing case; add result shapes; verify shape tests and job-progress tests with fake timers
- [ ] 1.3 Implement `getServiceSettings` and `saveServiceSettings` and reflect settings in health-check details; verify shape tests and a save-then-health test
- [ ] 1.4 Add the connection-changed event to the data facade and refresh `getConnection` consumers on it; verify a test that the header indicator updates immediately after disconnect

## 2. Dataspace area

- [ ] 2.1 Implement the connection section (state, expiry, identity, connect form with credential, error causes, disconnect with confirmation, not-configured state); verify component tests (spec: dataspace → Connection, Area works when disconnected or failing)
- [ ] 2.2 Implement peers with URL-selected peer and capabilities in both directions, and policy grant/deny/reset with confirmation; verify component tests (spec: dataspace → Compatible peers, Peer policy)
- [ ] 2.3 Implement incoming capability requests with approve/deny and note, including already-decided handling; verify component tests (spec: dataspace → Capability requests)
- [ ] 2.4 Implement the data-sharing tier explanation; verify a component test that the configured tier is marked and each tier lists its data (spec: dataspace → Data-sharing tier explained)

## 3. System area

- [ ] 3.1 Implement dependency health table with overall health, check time and check again; verify component tests (spec: system-health → Dependency health)
- [ ] 3.2 Implement service settings with validation, changed markers and reset; verify component tests (spec: system-health → Service settings)
- [ ] 3.3 Implement the session section; verify a component test (spec: system-health → Session state)
- [ ] 3.4 Implement the knowledge base: pipeline switch with explanations, document table, drop zone and file picker with type/size checks, upload progress and failure, description edit, delete with confirmation, test query with ranked results; verify component tests per scenario (spec: knowledge-base → all requirements)

## 4. Integration checks

- [ ] 4.1 Replace the last placeholders and remove the placeholder view; add end-to-end tests: disconnect → header updates → connect with credential; approve a request → peer capability granted; change a setting → health detail updates; upload a document → done → test query finds it; verify all pass
- [ ] 4.2 Extend the accessibility suite to the Dataspace and System areas (including dialogs and the drop zone) in both themes; verify zero axe violations and keyboard operation, including uploading via the file picker
- [ ] 4.3 Run the complete end-to-end suite on the full UI and `openspec validate --all --strict`; verify both pass and record per-scenario results in the Pull Request

## Workflow follow-up

- A maintainer adds the `spec-approved` label before any task above starts.
- After all four changes of issue #3 are merged, archive them in one follow-up Pull Request; verify `openspec/specs/operator-ui/` contains all capabilities.
