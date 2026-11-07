# Proposal

Issue: #29

## Why

After an escalation nothing comes back: the conversation is a mock. Operators need to receive the machine builder's messages, get help answering them, and carry the exchange to a close, with nothing leaving the factory unless they confirm it.

## What Changes

- An inbox poller: `GET /inbox/messages?status=received` every `INBOX_POLL_INTERVAL_S`, routing by performative, with `GET /conversations/{id}` as the source of state, received files stored, and acknowledging only after what was received is stored, so nothing is lost or handled twice.
- A conversation agent, separate from the read-only diagnostic workflow: it reads data, and answers the operator. Its protocol tools only prepare a suggestion. It has no way to send, and it is rebuilt from stored steps on every turn.
- Routes for `sendConversationAct`, `askAgent`, `refreshConversationStatus`, `recordMachineBuilderClose`, `approveDataRequest`, `replyToRecommendation`, `reopen` and received files.
- A grant sends `grant` and the data. Stopping a run with an open conversation sends `close(withdrawn)`. Reopening an incident continues its conversation in a new run, except after `escalated` and `superseded`.
- Incidents record the chat, conversation state, builder and outcome.
- Repeatable evaluation cases for tool selection and behaviour, without a dataspace.

**Decisions the issue asks for:**

- `awaiting_operator_approval` is entered for **every** `request` that names a capability, within the tier or not, until the operator decides.
- `awaiting_recommendation_review` is entered for an `inform` whose payload has `recommendation`: a text, or `{summary, actions[]}`. It is read from that field and no model is involved, so it can't be made up.

## Capabilities

### New Capabilities

- `backend/conversation`: Inbox, routing, sending and closing.
- `backend/conversation-agent`: The agent, its tools and evaluation.

### Modified Capabilities

- `backend/run-api`: New routes, stop and reopen.
- `backend/incident-records`: The chat and conversation state.
- `operator-ui/data-source`: The backend source serves the conversation.
- `operator-ui/machine-builder-conversation`: A request within the tier waits for the operator too.

## Impact

- `backend/`: new `app/runs/conversation.py`, `app/runs/inbox.py`, `agent/xana_agent/conversation/`, `migrations/006_conversation.sql`; changes in `app/dataspace/gateway.py`, `app/runs/manager.py`, `app/runs/model.py`, `app/memory/store.py`, `app/api/runs.py`, `app/main.py`, `app/config.py`.
- `frontend/`: `src/data/sources/backend/runs.js`, `src/data/conversationActs.js`, `Conversation.jsx`, `docs/data-interface.md`.
- `architecture.md`: Policy-gated data sharing, Inbox polling, Key Design Decisions (a conflict; see `design.md`).

## Out of Scope

- A conversation a machine builder starts, with no run behind it: left unacknowledged and listed.
- Automatic closing, and retrying a send other than `close(withdrawn)`.
- Any change to the dataspace.
