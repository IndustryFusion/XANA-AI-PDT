# Proposal

Issue: #54

## Why

The conversation agent that helps the operator answer the machine builder doesn't know what XANA diagnosed, so asked "what did you diagnose?" it can only guess or read the data again. Closing offers only resolved, not resolved and escalated, while the dataspace offers more. And closing as escalated is offered only once the operator has escalated, while the dataspace requires `escalate` before such a close, so an operator in an open conversation has to do two steps the protocol could take for them.

## What Changes

- **Diagnosis in context.** Each turn of the conversation agent gets the run's diagnosis: root cause, confidence, the top three hypotheses with their confidence, and the machine's active alerts as the run observed them. An evaluation case checks that it answers "what did you diagnose?" from it.
- **Outcomes.** Closing offers `rejected` and `timed_out` as well as resolved, not resolved and escalated, in the states where the operator may close: an open conversation, and one the operator escalated.
- **Escalated close.** Closing as escalated from an open conversation sends `escalate` first and waits until the machine builder's side has accepted it, then sends `close` with outcome `escalated`. If the `escalate` is refused, or its delivery fails, nothing more is sent and the operator sees why.
- The run's record and the incident keep the outcome as sent.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `backend/conversation`: The close outcomes, and the escalated close from an open conversation.
- `backend/conversation-agent`: The run's diagnosis in each turn, and an evaluation case.
- `operator-ui/machine-builder-conversation`: The outcomes offered per state, and the escalated close from an open conversation.

## Impact

- `backend/`: `app/runs/conversation.py`, `agent/xana_agent/conversation/` (input, prompt, cases), tests.
- `frontend/`: `src/data/conversationActs.js`, `src/features/incidents/Conversation.jsx`, both data sources, `docs/data-interface.md`, tests.
- `architecture.md`: none. The conversation section names the acts, not the outcomes.
- No change to the published dataspace contract: this follows `protocol.md` as it is.

## Out of Scope

- `superseded` as an operator's outcome, and `withdrawn` other than through cancel, which already sends it.
- Closing while the machine builder has escalated: the protocol refuses it.
- Sending the diagnosis to the machine builder: it goes to the conversation agent only. What the operator sends is unchanged.
