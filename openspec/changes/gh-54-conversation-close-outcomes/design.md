# Design

## Context

The contract is `protocol.md` in the dataspace repository: outcomes `resolved`, `withdrawn`, `rejected`, `failed`, `timed_out`, `superseded`, `escalated`; `close` is allowed while `OPEN`, and while `ESCALATING` by the escalator; `close` with outcome `escalated` requires `escalate` first. Notifications of one side's steps reach the other in the order that side took them, but a failed or refused notification is final and leaves the receiver's copy where it was. `backend/conversation` already sends `close` with the operator's outcome, mapping `not_resolved` to `failed`, and accepts only `resolved`, `not_resolved` and `escalated`. There is no conflict with `architecture.md` or the specs.

## Decisions

### Which outcomes where

| XANA state | Protocol state | Offered |
|---|---|---|
| `open` | `OPEN` | resolved, not resolved, rejected, timed out, escalated |
| `direct_contact_operator` | `ESCALATING`, by this side | the same |
| `direct_contact_machine_builder` | `ESCALATING`, by the builder | none, as now |

`not_resolved` is still sent as `failed`. `rejected` and `timed_out` are sent as they are. The backend refuses any other outcome as `invalid`, and an outcome the state doesn't allow as `conflict`, before sending anything.

### Escalate, then close, one after the other

From `open`, the backend sends `escalate`, records it as a message step as for any `escalate`, and then follows that message's status at the gateway. Once it reads `notified`, the machine builder's copy is `ESCALATING`, and the backend sends `close` with outcome `escalated`. If the `escalate` is refused when sent (`409`, `422`, `403`), nothing more is sent and the refusal reaches the operator. If its notification ends `error` or `rejected`, nothing more is sent and the operator is told that the machine builder did not get the escalation; the conversation is then escalating on this side only, and the operator can de-escalate or close again, which repeats the `escalate` first. If it is still on its way after 60 seconds, the close is not sent, and the operator is told to close again once it has arrived; the conversation is escalating meanwhile, as the operator asked.

Alternative: send `escalate` and `close` at once and rely on order. A failed `escalate` notification would then make the builder refuse the `close`, and a conversation closed as `escalated` can't be reopened, so the two copies would stay different for good.

Both steps run under the run's sending guard, so no other act of the operator falls between them, and an `escalate` from the machine builder crossing ours is resolved by the protocol's lower-id rule; if the builder wins, the conversation is escalated by the builder, and the close is not sent.

### The diagnosis given to the agent

Each turn gets a "diagnosis" block, from the run's stored state: root cause, confidence, the three hypotheses with the highest confidence (each with its confidence and status), and the active alerts the run observed for the machine, with severity and event. It's built from the latest round, so a reopened run gives the newest diagnosis. A run with no diagnosis yet says so. The block is data, like the peer's messages, and goes only to the model; the agent can't send it, and what the operator sends stays the operator's choice.

Alternative: let the agent read the diagnosis through a tool. The question is common and the block is small, so a tool call each time costs a turn of the 6 allowed.

## Risks

- The diagnosis may hold more than the run's sharing tier lets XANA send. It reaches the model only; a suggestion the agent drafts from it is shown to the operator, who decides what to send, as for any suggestion now.
- A close as escalated from `open` can take up to a minute while the `escalate` is delivered.
