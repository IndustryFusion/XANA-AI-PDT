# Design

## Context

See proposal.md → Why. Builds on the three earlier changes of issue #3. The UI data interface documents all `dataspace`, `knowledgeBase` and `system` operations; the mock implements `getConnection`, `listPeers` and `getHealth`. The dataspace connection state is already shown in the header and the dashboard and controlled by the mock data controls.

## Goals / Non-Goals

**Goals:**
- Complete the operator UI: every navigation entry leads to a working area.
- Make data sharing understandable to operators, not only to administrators.

**Non-Goals:**
- Changing the data-sharing tier from the UI; it remains deployment configuration (`architecture.md` → Configuration).
- Previewing document contents.

## Decisions

### 1. Dataspace layout
Three sections on one page: connection (state, identity, connect/disconnect), peers (list on the left, selected peer's capabilities in both directions on the right, with policy actions), and incoming requests; the data-sharing tier explanation sits next to the connection. Selected peer in the URL (`/dataspace?peer=…`).
*Alternatives:* separate tabs per section hide the relation between a request and the peer's capabilities.

### 2. Shared connection state
After connect or disconnect, the Dataspace area triggers a refresh of every `getConnection` consumer (header indicator, dashboard tile) through a small connection-changed event in the data facade, so all views agree immediately instead of at their next poll.
*Alternatives:* waiting for the next poll leaves the header showing a stale state for up to 30 s.

### 3. Service settings
Settings are read with `getServiceSettings` (deployment values plus operator overrides) and saved with `saveServiceSettings`; the mock stores overrides in its store. URL validation in the form uses the browser URL parser and accepts `http`, `https`, `ws`, `wss` and `mqtt` schemes.
*Alternatives:* keeping overrides only in the browser's local storage would make them invisible to a backend adapter that needs them.

### 4. Knowledge-base uploads
Files are read in the browser and passed to `uploadDocument`; the returned job is polled with `getIngestJob` every second (mock: progress advances in steps and finishes after a few seconds; a file whose name contains "corrupt" fails, to demonstrate failure). Size limit 50 MB; accepted types PDF, DOCX and Markdown by extension and MIME type.
*Alternatives:* a streaming upload API does not exist in the interface.

### 5. Test retrieval in the mock
The mock ranks seeded passages (from a few built-in sample manuals for the seeded machines) by simple term overlap and returns score, document and page or section. Deterministic, so tests can assert ranking.
*Alternatives:* embedding-based ranking in the browser would add heavy dependencies for a demonstration.

### 6. Health checks
`getHealth` results are shown in a table; "check again" calls it with a fresh flag. Saved service settings change which addresses the mock reports in each check's detail, so the effect of a change is visible.
*Alternatives:* none needed.

## Conflicts with `architecture.md` and existing specs

- None. Tiers and capabilities follow `architecture.md` → Policy-gated data sharing (`minimal`/`twin:direct`, `adjacent`/`twin:adjacents`, `timeseries`/`twin:history`).
- The foundation's dataspace indicator and dashboard tile stay as specified; decision 2 only makes them update sooner.

## Risks / Trade-offs

- [Operators change service addresses by mistake] → Changed values are marked, can be reset to the deployment value, and the health check shows the effect immediately.
- [Policy changes affect what machine builders can access] → Every grant, deny and reset requires confirmation that names the peer and capability.
- [Stacked on three unmerged changes] → Rebased if any lower change is revised in review.
