# Tasks

## 1. Backend

- [ ] 1.1 Give the conversation agent the run's diagnosis; verify with agent tests for the block, the latest round, and no diagnosis
- [ ] 1.2 Add evaluation cases for "what did you diagnose?" and for a run without a diagnosis; verify the cases run and fail when the block is left out
- [ ] 1.3 Accept `rejected` and `timed_out`, refuse other outcomes and states; verify with stub gateway tests
- [ ] 1.4 Escalate, wait for the notification, then close; verify with stub tests for success, a refused `escalate`, `error` and `rejected` notifications, the 60-second limit, crossing escalations, and another act during it
- [ ] 1.5 Record the outcome in the run and the incident; verify with database tests

## 2. Frontend

- [ ] 2.1 Offer the outcomes per state, and escalated from open; verify with tests of `closeOutcomes` and the form
- [ ] 2.2 Show a refused or undelivered `escalate` in the form; verify with component tests and the mock source

## 3. Verification on a real dataspace

- [ ] 3.1 Close with each outcome; verify each is accepted, both sides' states, and the archived incident's outcome, against the dataspace's gateway, adapters and a machine-builder participant
- [ ] 3.2 Close as escalated from `OPEN`; verify `CLOSED_ESCALATED` on both sides
- [ ] 3.3 An `escalate` refused by the machine builder's side; verify no `close` is sent
- [ ] 3.4 Ask the agent what it diagnosed in a run; verify the answer with a model if one is available here, and otherwise say so
