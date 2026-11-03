# Tasks

## 1. Mock run engine and scenarios

- [x] 1.1 Implement the run engine (stages, timed events, waits for operator actions, playback speed, pause/resume) storing run state in the mock store; verify unit tests with fake timers for ordering, waiting, speed and resume-with-snapshot (spec: run-simulation → Simulated runs, Simulated connection loss)
- [x] 1.2 Write the eleven scenario scripts including the simulated machine builder; verify one unit test per scenario that drives it to its documented end state (spec: run-simulation → Named scenarios, Simulated machine builder)
- [x] 1.3 Implement the mock `runs` operations (`startRun`, `getRun`, `subscribeRun`, `clarify`, `confirmResolution`, `escalationPreflight`, `escalate`, `approveDataRequest`, `replyToRecommendation`, `sendConversationAct`, `askAgent`, `getOutboxStatus`, `refreshConversationStatus`, `recordMachineBuilderClose`, `reopenRun`, `stopRun`, `archiveRun`) with `conflict` errors for invalid states; add their result shapes to `SHAPES`; verify data-interface shape tests and conflict tests
- [x] 1.4 Seed past incidents and implement `listIncidents`, `getIncident`, `reopenIncident`; archived runs become incidents; verify shape tests and an archive-then-list test
- [x] 1.5 Add scenario selection, playback speed and "interrupt connection" to the mock data controls; verify component tests and that the production bundle check still passes
- [x] 1.6 Document the `connection` run event and attachment format in `frontend/docs/data-interface.md`; verify the interface documentation test passes

## 2. Shared components

- [x] 2.1 Add `ConfidenceMeter`, `StructuredFields`, `ConfirmDialog` and `FileAttachments` (size and count limits); verify component tests for percentage text, labelled fields, confirm/cancel and rejected oversize files

## 3. Active incidents

- [x] 3.1 Implement the Active incidents page layout, open-runs list (status label, age, incident number, newest first, selection, live updates) and machine filter from the URL with clear action; verify component tests (spec: active-incidents → Open runs list, Select a run, Filter by machine)
- [x] 3.2 Implement the new-incident form with prefill and focus, validation, disabled state and error display; verify component tests (spec: active-incidents → Start a new run)
- [x] 3.3 Replace the incidents placeholder in routing; verify the foundation's cross-navigation tests now reach the real form and selected run

## 4. Run view

- [x] 4.1 Implement `useRun` (snapshot, steps, status, connection state) and the run header; verify unit tests including reconnect snapshot replacement (spec: run-view → Run header, Live connection resilience)
- [x] 4.2 Implement the step feed with per-kind renderers, generic fallback, expandable structured output and the policy-check rendering; verify component tests (spec: run-view → Live step feed)
- [x] 4.3 Implement hypotheses and decision card; verify component tests for validated replacement and ordering (spec: run-view → Hypotheses, Decision)
- [x] 4.4 Implement the clarification, resolution, recommendation and approval panels with action errors kept in place; verify component tests per panel (spec: run-view → State panels)
- [x] 4.5 Implement the escalation pre-flight dialog; verify component tests for possible and not-possible escalation (spec: run-view → Escalation pre-flight)
- [x] 4.6 Implement outcome panels and stop, reopen, archive with confirmation; verify component tests (spec: run-view → Run outcomes, Stop, reopen and archive)

## 5. Machine-builder conversation

- [x] 5.1 Implement the two-tab run view after escalation with unread badge; verify component tests (spec: machine-builder-conversation → Conversation view after escalation)
- [x] 5.2 Implement the message thread with delivery status and the escalation summary for an empty thread; verify component tests (spec: → Message thread)
- [x] 5.3 Implement the act composer driven by the shared allowed-acts table, close with outcome, suggested actions and agent questions; verify component tests for acts per conversation state (spec: → Structured acts, Suggested actions, Questions to the incident agent)
- [x] 5.4 Implement status check and manual close recording; verify component tests (spec: → Conversation status check)

## 6. Incident history

- [x] 6.1 Implement the history list with search, machine/outcome/date filters, URL machine filter and empty state; verify component tests (spec: incident-history → Incident list)
- [x] 6.2 Implement incident detail with conversation transcript and expandable trace, not-escalated variant, and reopen; verify component tests (spec: incident-history → Incident detail, Reopen from history)

## 7. Integration checks

- [x] 7.1 Add one end-to-end test per mock scenario driving the UI from start to the scenario's end state at high playback speed; verify all pass (spec: run-simulation → Named scenarios; machine-builder-conversation → Policy-gated data requests)
- [x] 7.2 Add end-to-end tests for connection interruption and recovery, history reopen, and dashboard → run navigation; verify all pass
- [x] 7.3 Extend the accessibility suite to the run view in each waiting state, the conversation and incident history in both themes; verify zero axe violations and keyboard operation of all panels and dialogs (spec: visual-system → Structured presentation, Keyboard operation)
- [x] 7.4 Run `openspec validate gh-3-ui-incident-workflow --strict` and the Frontend CI; verify both pass and record per-scenario results in the Pull Request

## 8. Review follow-up

- [x] 8.1 Colour-code runs and confidence: status stripe on open runs, past incidents, dashboard entries and the run header, pulsing badge for runs in progress or waiting for input, confidence bands high (≥ 70 %, green), medium (≥ 40 %, amber) and low (red) with the level as text on hypotheses, decisions, panels and steps; verify component tests and zero axe violations in both themes (spec: visual-system → Readable status, Contrast; run-view → Hypotheses, Decision)

## Workflow follow-up

- A maintainer adds the `spec-approved` label before any task above starts.
- After merge, archive with `/opsx:archive gh-3-ui-incident-workflow`, together with the other changes of issue #3.
