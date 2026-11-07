# Design

## Context

`gateway-api.md` and `protocol.md` of the dataspace repository are the contract. `architecture.md` has an escalation flow that this follows, except as stated below.

## Conflicts and differences

- **`architecture.md` has the request sent after the file; `flow.md` of the dataspace has it the other way round.** The issue names files first. It is kept, since a machine builder then never gets a request whose data failed to send. The file starts the conversation, and the request carries its ID.
- **Tier and access.** The issue: XANA filters to the tier. `protocol.md`: read `GET /capabilities/access` before sending, and share only what it allows. Both apply here: a capability is sent only if the tier includes it **and** the dataspace's access for this builder is `auto` or `approved`. So `adjacent` sends only the machine's own data until the builder's access to `twin:adjacents` is approved. The Dataspace screen does that, and the policy check shows what was held back and why.
  Alternatives: the tier alone, which ignores a denial recorded in the dataspace; treating `on-request` as allowed, which sends data the builder is meant to ask for first.
- **Alerts.** The issue's table doesn't name them, and #25 keeps them "with the machine data for #28". A machine's active alerts go with `twin:direct` as part of its current state, and those of related entities with `twin:adjacents`. Alternative: leave them out, or a tier of their own. Raised for review.

## Decisions

### Order, and what a failure leaves

1. Plan: builder, peer, access, data. Nothing is sent, and a failure refuses the request.
2. `policy_check` step, stored.
3. `POST /outbox/files`, starting the conversation. Its message ID is stored.
4. `GET /outbox/messages/{id}` for the conversation ID, stored.
5. `POST /outbox/messages`, a `request` in that conversation, `reply_expected`.
6. Stored: `awaiting_machine_builder`, the reference, the outbox, an `escalate` step.

A failure after step 2 records an `escalate_failed` step, answers `unavailable` or as the gateway refused, and leaves the status alone, so the run can go on being worked on. Trying again uses what was stored: it doesn't send the file again, as there is no idempotency key. If the backend stops between a send being accepted and it being stored, trying again sends that step again: the contract offers no way out of this.

### One operation at a time, without holding the run's lock

A send can take 2 minutes, and the lock also holds up watchers. So a run has an in-memory `busy` mark, set under the lock. While it is set, a second escalation and every other operator action are refused as `conflict`. The stream keeps working.

### What a tier sends

| Capability | Files |
|---|---|
| `twin:direct` | `machine.json`: the entity read anew, with its active alerts |
| `twin:adjacents` | `related-entities.json`: entities one relationship away, at most 20, with their active alerts |
| `twin:history` | `signal-history.json`: the machine's own stored values of the last 24 hours, numbers and text alike, one entry per attribute, at most the newest 500 values. Related entities' signals, such as those of its sensors, are not part of it. A builder's data request that names attributes gets only those (#29) |

They go as one bundle, as the contract delivers files as one ZIP, naming the highest capability sent. The incident message holds the reference, machine ID, issue, the state of the diagnosis, the tier, and the names of the files; no data beyond those. A source failing fails the send rather than sending less than the operator saw.

### What history holds: decided by a maintainer

The maintainer decided that history holds the machine's own values only, of every type, for 24 hours, and that a grant of `twin:history` sends what the `timeseries` tier does: the machine's entity data, related entities and the history (#29). Escalation at a tier keeps the access check above: each capability goes only if its access is `auto` or `approved`, so at `timeseries` with `twin:adjacents` held back, the history still goes, with the machine's own values.
Alternatives that were considered: hourly buckets of numeric signals only; adding related entities' signals when `twin:adjacents` goes too, which the first version did and which makes a history-only sending hold nothing where signals are kept on sensors; sending nothing and saying so; asking for `twin:adjacents` too.

### Outbox

A background task polls `GET /outbox/messages/{id}/status` every 5 seconds for messages not yet final, and stores the result. `pending` and `registered` show as `pending`, `notified` as `delivered`, and `error` and `rejected`, which are final, as `failed` with the gateway's message. `notified` means only that the receiver accepted the notification. A failed delivery leaves the run in `awaiting_machine_builder`: it's shown, and #29 adds what to do.

### Storage

`runs` gets `escalation`, `outbox`, `conversation_id` and `attempt`. `incidents` gets `builder`, `escalation`, `conversation_id`. A restart restores them with the rest of the run, and no work is started for a waiting run.

### References

`ESC-<incident number>`: one per run, and readable next to it.

## Risks

- Stopping a run in `awaiting_machine_builder` in this change leaves the builder's conversation open. #29 sends `close`.
