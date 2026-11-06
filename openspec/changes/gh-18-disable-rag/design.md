# Design

## Context

See proposal.md - Why. The backend has no retrieval code, and `architecture.md` already notes that the workflow has no RETRIEVE step. The remaining references are in the frontend and in the documents.

## Goals / Non-Goals

**Goals:**

- No knowledge base screen, operation, status or step is visible with the default settings, on either data source.
- Turning it back on is one documented change.

**Non-Goals:**

- Removing the code, or designing how retrieval returns.

## Decisions

**One build setting, off by default.** A single setting, `VITE_KNOWLEDGE_BASE`, follows the way `VITE_DATA_SOURCE` already selects the data source. The screen, navigation entry, data area and mock retrieval step all read it. Alternatives: commenting the code out, rejected because commented code is not linted or tested and would stop working unnoticed; deleting the code, rejected because the issue requires it to be able to return.

**The specification stays, with one added requirement.** `operator-ui/knowledge-base` gains a requirement stating that it is off by default and that its other requirements apply when it is on. Alternative: removing its requirements, rejected because they would be lost, and the spec would be left empty.

**The area leaves the data interface when off.** With the setting off, the data layer exposes no `knowledgeBase` area, so nothing can reach mock documents, on either data source. Alternative: keeping the area and returning empty results, rejected because a backend build would then appear to have a working, empty knowledge base.

**Knowledge base tests keep running.** They run with the setting on, so the code stays working while it is off, and new tests cover the default. Alternative: skipping them, rejected because re-enabling would then be untested.

## Architectural implications

There is no change to the architecture of the running system. `architecture.md` currently describes retrieval as present, and this conflict is resolved by marking it as not part of the current system while keeping the description, so it is available if retrieval returns. Other corrections: the registry lookup for a machine builder is `GET /company/assets/{id}/manufacturer`, and `IFRIC_REFRESH_TOKEN` is not used, if mentioned.

## Risks / Trade-offs

- [A setting adds a code path] → It is one setting, read in few places, and both states are tested.
- [Scenario-based mock tests depend on the retrieval step] → Tests are updated, and step order is covered by the delta spec.
- [Build-time setting] → Changing it needs a rebuild, which is acceptable because it is not an operator choice.

## Open Questions

None.
