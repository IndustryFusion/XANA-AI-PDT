# Design

## Context

Both subscriptions are checked the same way today:
- **Live updates** (`app/ngsi/live.py`). Every 5 s tick, `_keep` either renews the subscription (when the token changed or it expires within an hour), or, once a minute, reads it with `GET /subscriptions/{id}`.
  - A `Refused` from the broker sets `subscription_failed`.
  - The minute's mark is set only after a successful read, so a refused read is repeated at every tick until the next renewal.
  - On the platform the token rotates about every 5 minutes, so renewals come often, and the state flips between `active` and `subscription_failed`.
- **Machine watch** (`app/events/subscription.py`). Every 15 s, `_verify` reads the subscription by ID once a minute, and also takes `notification.status` from it.
  - 404 means gone, and it is created again.
  - Any other non-200 answer, including 403, sets `failed` and clears `_ensured`, so the next tick POSTs, gets 409, PATCHes, and is `active` again.

**What the broker answers** with an operator's token, on the platform:
- `GET /subscriptions/{id}`: 403, also for an ID that doesn't exist.
- `GET /subscriptions`: 200, with both of the backend's subscriptions in it. Its entries carry no `notification.status`; they have the subscription's own `status`, `timesSent` and `timesFailed` at the top level.
- `PATCH /subscriptions/{id}`: 204.

A 403 to the read by ID therefore says nothing about whether the subscription exists.

**Conflict with the specs.** `backend/machine-events` "The subscription", scenario "Refused", makes any refusal, including 401 and 403, a `failed` state. The delta narrows that scenario so that a refused read by ID alone isn't a refusal. No other requirement conflicts, and `architecture.md` is not affected.

## Goals / Non-Goals

**Goals:**
- One rule for "still in place", used by both checks.
- The broker's real refusals still surface, with their reason.

**Non-Goals:**
- Changing the renewal schedule, the sweep at start, or the MQTT side of live updates.

## Decisions

### The check: by ID, then the list, then a renewal

Each check, once a minute, tries these in order and stops at the first that answers:

1. **`GET /subscriptions/{id}`.**
   - 200: in place, and for the machine watch, take `notification.status` from it.
   - 404: gone.
   - 401 or 403: go on to step 2.
   - Any other refusal is a failure, as today.
2. **`GET /subscriptions`, with `limit=1000`, the limit the sweep already uses**, looking for the ID.
   - Found: in place, with `notification.status` from the entry.
   - Not found: gone.
   - 401 or 403, or an answer that isn't a list of subscriptions: go on to step 3.
   - Any other refusal is a failure.
3. **A renewal.** For live updates, this is the existing PATCH with the expiry and endpoint. For the machine watch, it is the existing PATCH with the subscription body.
   - 204: in place.
   - 404: gone.
   - Otherwise it is a failure, with that answer as the reason.

**"Gone"** goes the existing way: live updates set `_exists = False`, so the next tick creates it. The machine watch clears `_ensured`.

**The minute's mark** is set when a check reaches an answer, also when it ends in a failure, so a refused read is not repeated every tick.

**Back in place.** A check that finds the subscription in place by any of the three steps sets the state the way a successful check does today: live updates go through `_report_delivery`, and the machine watch through its delivery status. So a state that an earlier check made failed returns to `active`, or to what delivery reports. For the machine watch, a failed state has already cleared `_ensured`, so the way back is the existing create, 409 and update, which sets `active` as today.

**The reason of a failure** names the HTTP status of the last answer and, for 401 or 403, that the token or identity lacks access, as the machine watch's `_refused` does today. It never holds the broker's message: a broker's message about a subscription can quote its endpoint, and the live-update endpoint holds the operator's token. The log keeps naming only the kind and status, as `_tick` does now. The broker doesn't say which of its roles allows reading a subscription by ID, so the reason says that access is lacking, not which role is missing.

The order and the answers are kept in one small helper per module: the two modules use different HTTP clients, a `ContextBroker` and a plain `httpx` client. The shared rule is in the spec, and each module's tests check it.

**Alternatives:**
- **Renew instead of reading, every minute.** It always works where PATCH is allowed, but it rewrites the subscription every minute and moves its expiry for nothing. For live updates, it sends the token-bearing endpoint far more often than needed.
- **Treat 403 to the read by ID as "in place".** This is simplest, but a subscription that really is gone would then never be noticed on this broker.
- **Remember per process that the read by ID is refused, and skip straight to the list.** It saves one request a minute, but gives a second path to keep correct. The read by ID is cheap, and a broker whose roles change is handled without a restart.

### Delivery status from the list entry

When the machine watch finds its subscription in the list, it reads `notification.status` from that entry, the same field it reads from the read by ID. If the entry has no such field, or the subscription was found in place by a renewal, delivery counts as working, as after the create and update the machine watch does today.

The platform's broker leaves `notification.status` out of its list entries. There, while the read by ID is refused, `delivery_failing` can't be seen. That is no worse than today, where the refused read gives no status either. Reading delivery failures from other fields, such as `timesFailed`, is not part of this change: their meaning differs between brokers, and the platform's could not be checked with a failing delivery.

**Alternative:** drop the delivery check when the read by ID is refused. It costs nothing to keep, and a broker whose list entries include `notification.status` still reports failing delivery.

### What is taken from the list

The list holds every subscription the token may see, also other backends' live-update subscriptions, whose endpoints carry their operators' tokens. The check only looks for its own ID in it, and takes nothing from it but whether the ID is there and, for the machine watch, that entry's `notification.status`. No part of the answer is logged, kept, or put in a state's reason. The sweep at start already reads the same list and keeps to the same rule.

### Paging of the list

1000 entries are read, as the sweep does. A subscription beyond the first 1000 would read as gone and be created again. The POST then answers 409 and is renewed with a PATCH, which both modules already handle. So the worst case is one needless request a minute on a very large broker. It is noted in the code.

## Risks / Trade-offs

- **[A broker that lists only some subscriptions to the token, and refuses the read by ID]** → The subscription would read as gone every minute, and "creating" it gives 409 and a renewal. Both stay `active`, at the cost of a list read, a POST and a PATCH a minute. For live updates, that PATCH sends the token-bearing endpoint every minute, which is the cost the first alternative above was rejected for. This is accepted only as the fallback for such a broker; it is not the normal path, and the platform's broker lists the subscription (task 3.1 checks this). Tests cover the 409 path.
- **[More requests when the read by ID is refused]** → At most one list read a minute per subscription, plus a renewal only when the list is refused as well.
- **[The reason names the last step's answer]** → A broker that refuses everything gives the renewal's refusal as the reason. That is the one an operator can act on: the role.

## Migration Plan

Nothing to migrate. The change is in the backend alone and takes effect at the next deployment, and rolling back restores the old check.
