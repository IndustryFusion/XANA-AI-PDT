# Proposal

Issue: #3

## Why

The foundation (`gh-3-ui-foundation`) gives the operator UI its shell, data layer and visual system, but the core of XANA AI PDT, diagnosing an incident with the agent, is still a placeholder. This change delivers the incident workflow end to end on mock data, so the diagnostic flow, the confidence gate, escalation to the machine builder and policy-gated data sharing can be seen, reviewed and tested before any backend exists. It is the second of four changes delivering issue #3.

## What Changes

- **Active incidents** area: list of open runs with status and age, filter by machine, and a new-incident form (machine ID and issue) that is prefilled when opened from an entity reference.
- **Run view**: header (incident number, escalation reference, machine, issue, status), live step feed, hypothesis cards with confidence, decision card, and one panel per waiting state: clarification, resolution confirmation, escalation pre-flight, operator approval of data requests, machine-builder recommendation review, closed by machine builder, stopped, completed and failed; stop, reopen and archive actions.
- **Machine-builder conversation** after escalation: message thread with delivery status, suggested actions, structured acts (inform, request, grant or deny, ask for or end direct contact, close with an outcome, cancel), free-text questions to the incident agent, unread indication, and a manual status check.
- **Incident history** area: searchable and filterable list of past incidents, detail with conversation and full agent trace, and reopen.
- **Run simulation** in the mock data source: a run engine that plays the agent workflow with realistic timing and named scenarios covering every run state, selectable in development, with a playback speed control.
- Mock implementations of the `runs` and `incidents` operations of the UI data interface.
- The dashboard's links to runs and new incidents now open real views instead of placeholders.

## Capabilities

### New Capabilities

- `operator-ui/active-incidents`: List of open runs, filtering by machine, and starting a new run.
- `operator-ui/run-view`: Presentation of one run: live steps, hypotheses, decision, state-specific panels and run actions.
- `operator-ui/machine-builder-conversation`: The conversation with the machine builder after escalation, including structured acts and policy-gated data sharing.
- `operator-ui/incident-history`: Browsing past incidents with their trace and reopening them.
- `operator-ui/run-simulation`: Simulated runs of the mock data source with named scenarios for every run state.

### Modified Capabilities

None. (The foundation capabilities are not archived yet; this change only adds capabilities.)

## Impact

- Code: `frontend/src/features/incidents/`, `frontend/src/features/history/`, the mock data source (`runs`, `incidents`, run engine, scenarios, dev controls), shared UI components for steps, hypotheses and decisions.
- UI data interface: implements the `runs` and `incidents` operations already defined in `frontend/docs/data-interface.md`; no operation is added or renamed. The run-event contract is used as documented.
- Dependencies: none added.
- `architecture.md` sections affected: none. Components → Frontend already describes these areas and run states.

## Out of Scope

- Backend, backend adapter and real agent runs.
- Data explorer, alerts, dataspace, system and knowledge-base areas (changes 3 and 4 of issue #3).
- Editing or deleting past incidents.
- Notifications outside the application (e-mail, push).
