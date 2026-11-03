# Design

## Context

See proposal.md → Why. This change builds on `gh-3-ui-foundation`: the router, session gate, `useData` hook, design-system components, entity references and the mock data source with its dev controls exist. The UI data interface already lists every `runs` and `incidents` operation and the run-event contract (`frontend/docs/data-interface.md`); the mock currently implements only `listActiveRuns`.

## Goals / Non-Goals

**Goals:**
- Implement the incident workflow against the existing interface without adding or renaming operations, so a future backend adapter needs nothing new.
- A run engine in the mock that is deterministic for tests and realistic in the browser.

**Non-Goals:**
- Server-side state machine semantics beyond what the UI needs to demonstrate (the backend issue owns them).
- Persisting simulated timers across reloads: after a reload, runs resume from their stored state.

## Decisions

### 1. Run state on the client: one subscription per open run view
`useRun(runId)` subscribes with `runs.subscribeRun` and reduces events into `{ summary, status, statusData, steps[], connection }`. The first event is the current state (snapshot), so mounting, reconnecting and reopening use the same path. The Active incidents list uses `useData('runs', 'listActiveRuns')` with a short refresh plus a refresh whenever the selected run's status changes.
*Alternatives:* a global run store would let several views share one subscription, but only one run view is visible at a time; polling `getRun` would delay steps and duplicate the stream's purpose.

### 2. Layout
Two columns on wide screens: open-runs list (left) and the run view or new-incident form (right); one column below 900 px with the list above. Run view: header, then either one diagnostics view, or, once escalated, two tabs ("Diagnostics", "Conversation") using the shared `Tabs` component with an unread badge.
*Alternatives:* a separate page per run loses the overview while working on one run.

### 3. Components
`features/incidents/`: `ActiveIncidents` (page), `RunList`, `NewIncidentForm`, `RunView`, `RunHeader`, `StepFeed` (step renderers keyed by `node` with a generic fallback), `HypothesisList`, `DecisionCard`, panels (`ClarificationPanel`, `ResolutionPanel`, `RecommendationPanel`, `ApprovalPanel`, `OutcomePanel`), `EscalationDialog`, `Conversation` (`MessageThread`, `ActComposer`, `AgentQuestion`, `SuggestedActions`).
`features/history/`: `IncidentHistory` (page), `IncidentList`, `IncidentDetail`, `TraceView`.
`ui/`: `ConfidenceMeter` (percentage text plus bar), `StructuredFields` (labelled rendering of structured output), `ConfirmDialog`, `FileAttachments`.
Which acts a conversation state allows is defined once (`conversationActs.js`) and used by both the UI and the mock, so they cannot disagree.
*Alternatives:* rendering step output as JSON would violate the visual-system requirement for structured presentation.

### 4. Mock run engine
- **Scenario scripts as data** (`sources/mock/scenarios/*.js`): each scenario is a list of stages; a stage is a sequence of timed events (`step` or `status`) and optionally waits for an operator action (`clarify`, `confirmResolution`, `escalate`, `approveDataRequest`, `replyToRecommendation`, `sendConversationAct`) and branches on its arguments.
- **Engine** (`sources/mock/runEngine.js`): one instance per run; plays stages with `setTimeout` scaled by the playback speed; appends steps and status data to the run record in the store (so `getRun` and reloads see the same state); notifies subscribers. A `pause`/`resume` per run implements "interrupt connection".
- **Simulated machine builder** is part of the scenario script: replies, data requests, recommendations and closes are scripted events triggered by the operator's acts.
- **Incidents**: when a run is archived it becomes an incident record (issue, root cause, decision, resolution, conversation, trace). The seed adds a dozen past incidents across machines and outcomes.
- Scenario for a new run: chosen in the dev controls (default: happy path); the seeded runs use fitting scenarios so the dashboard and list show varied states.
*Alternatives:* a statechart library would add a dependency for something a small interpreter of plain data handles; random behaviour would make tests flaky.

### 5. Timing and tests
Base delays (for example 600–1500 ms per step, 3–6 s for machine-builder replies) are multiplied by `1 / speed`. Component tests use fake timers; end-to-end tests set a high playback speed through the controls preset, so each scenario finishes in seconds.
*Alternatives:* zero delays in tests would hide ordering bugs that only appear with asynchronous arrival.

### 6. Connection resilience
The mock's `subscribeRun` supports interruption (dev control). On interruption the source emits nothing until resumed, then emits a fresh snapshot. `useRun` shows "Reconnecting…" while the source reports `{ type: 'connection', state: 'reconnecting' }` and replaces its state with the next snapshot. The same contract applies to a future backend adapter (WebSocket reconnect plus status poll), documented in `data-interface.md`.
*Alternatives:* leaving resilience to each adapter without a UI-visible event would hide outages from the operator.

### 7. Files and attachments
Clarifications and rejections accept files (images, PDF, text) read in the browser and passed to the interface as `{ name, type, size, dataUrl }`; the mock keeps only metadata. Limit 10 MB per file, 5 files per submission, enforced in the UI.
*Alternatives:* uploading separately before submitting adds an operation the interface does not have.

## Conflicts with `architecture.md` and existing specs

- None for this change. `architecture.md` → Components → Frontend (updated by `gh-3-ui-foundation`) lists these areas and run states. The run stream may contain several retrieval steps; the generic step renderer keeps the UI independent of how retrieval is split.
- The foundation's specs (`operator-ui/app-shell`, `dashboard`, `data-source`, `visual-system`) are not archived yet; this change adds new capabilities only. Its run view fulfils the visual-system requirement on structured presentation, which had no subject before.

## Risks / Trade-offs

- [Scenario scripts drift from real backend behaviour] → Scripts emit only events defined in the interface contract, and the interface tests check their shapes; the backend issue reuses the scenarios as acceptance cases.
- [Long scenarios slow down end-to-end tests] → Playback speed preset in tests; scenarios are covered in parallel workers.
- [Large feature in one change] → Components are split per panel and tested per scenario; the history area is independent of the run view.
- [Stacked on an unmerged change] → If `gh-3-ui-foundation` changes in review, this branch is rebased onto it.
