# Design

## Conflicts

- **`architecture.md` and the spec `operator-ui/machine-builder-conversation` send data within the tier automatically. The issue says nothing is sent to a peer without confirmation.** The issue is later and an acceptance criterion, so a request within the tier waits too, and shows that it is within the tier. The spec's scenario is modified here, and `architecture.md` is corrected. Alternative: keep automatic sending within the tier, which makes that criterion false.
- **The UI's `cancel` means withdrawing the escalation and stopping the run.** The protocol's `cancel` needs `in_reply_to` and changes no state. So the UI's act is sent as `close` with outcome `withdrawn`. A `cancel` received is recorded, and withdraws the request it names.
- **The UI's outcome `not_resolved` isn't in the protocol.** It is sent as `failed`.
- **`grant` and `deny` need a capability under the protocol, and the UI offers them for any request.** A free-text request isn't answerable by them: the source marks it, and the operator answers with `inform`.

## Decisions

### The order of receiving

1. Read the message from the list.
2. If its ID is in `processed_inbox`, acknowledge it and stop.
3. Find the run by `conversation_id`. None: an archived incident gets it added to its record. Otherwise it isn't acknowledged, and stays for later: content that isn't acknowledged is kept.
4. Read `GET /conversations/{id}`, the source of state.
5. Download its files, and store them.
6. In one transaction: the run with the new step and status, and the ID in `processed_inbox`.
7. Tell watchers. Acknowledge.

Any failure before 6 leaves it unacknowledged, for the next poll. A crash between 6 and 7 finds the ID at step 2. `received` means ready, so a `404` on the download is retried 5 times and then the message is stored saying that the files are gone, rather than held forever. Messages are handled oldest first, one at a time, by one task. The contract doesn't promise order, so state always comes from step 4.

### State

`OPEN` is `open`. `ESCALATING` is `direct_contact_operator` when this participant escalated and `direct_contact_machine_builder` otherwise. `CLOSED_*` is `closed`.

A run's status follows from its steps, so that one thing arriving during another can't lose either: a data request not yet answered gives `awaiting_operator_approval`, the oldest first; otherwise a recommendation not yet answered gives `awaiting_recommendation_review`; otherwise `awaiting_machine_builder`.

### Sending

Only an operator's request sends. The `busy` mark of `gh-28-escalate-to-builder` holds while sending. After a restart, what `GET /conversations/{id}` holds and the run doesn't is added as steps, which covers a crash between a send being accepted and being stored. A refusal (`409`, `422`) is shown, and the conversation's state read again. Delivery uses the outbox of #28.

### A grant

`POST /capabilities/policy` to approve, as `grant` doesn't change approval records, then `grant` with `authorization` `{scope: "conversation", expires_at: 30 days ahead, constraints: {}}`, then the capability's data with `POST /outbox/files` in reply. A failure after the `grant` is stored, and approving again sends only the files. Declining sends `deny`, and doesn't change the access record.

### Stopping

`close(withdrawn)` is sent. If it can't be, the run stops anyway, showing that, and the poller repeats it until it is accepted: a duplicate `close` is safe under the protocol. One the receiver didn't get is repeated too, after 60 seconds and then twice as long each time, up to an hour, with one close in the conversation, however often it had to go.

### What a grant of history delivers

The machine's own signals, and related entities' only if `twin:adjacents` is allowed for this builder, by tier and access. On platform data signals are mostly on sensors, so a grant of history alone, at a tier or access without related entities, can hold none. **The policy check says how many signals went, and `0 signals` when none did.** No state or confirmation is added for this. Which default is right when related entities aren't allowed is for a maintainer: send nothing and say so, ask for `twin:adjacents` too, or include sensors' signals anyway.

### The agent

Structured, one action a turn, in the way the workflow's model calls are: a `think` node and a `tool` node in a graph of its own, at most 6 tool calls a turn. It pauses by ending: a turn gives a reply and suggestions, and the next turn starts from the run's stored steps, so a restart loses nothing. The package has no way of reaching the gateway: `send_*` add a suggestion, which the operator can use in the composer. `open_inbox`, `open_outbox` read the stored messages, and `set_response` ends the turn with the reply.

Reads are limited to the machine and the entities observed in the run, so a peer's text can't widen them. The model may write SPARQL, which goes through `query`'s checks. A peer's text is data in the prompt.

A review of a data request, free-text request or recommendation runs in the background after the message is stored. A model failure doesn't touch the message; a review not done is done after a restart.

### Files

Stored in `conversation_files` up to 50 MiB a message, and otherwise left at the gateway, fetched on demand. Retention can remove those.

### Evaluation

Cases in `xana_agent/conversation/cases.json`: the conversation, what the model should use, and what must never happen. `python -m app.evaluate` runs them with the configured model. Pytest runs them with a scripted model that follows rules, so behaviour outside the model, such as nothing being sent and reads staying limited, is checked in CI.

## Limits

Single process, as for all runs. A message with no run stays unacknowledged, and is logged once per message.
