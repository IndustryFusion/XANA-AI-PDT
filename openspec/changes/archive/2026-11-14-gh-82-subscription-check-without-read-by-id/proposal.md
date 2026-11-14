# Proposal

Issue: #82

## Why

On the platform's context broker, reading a single subscription by its ID (`GET /subscriptions/{id}`) is refused with 403 for an operator's token, also for an ID that doesn't exist. Listing subscriptions and renewing one by ID work. The backend checks both of its subscriptions with that single read every minute:
- **Live updates.** They are reported as `subscription_failed` until the next renewal.
- **Machine watch.** It is reported as `failed`, and is updated again at the next try.

So both states flap while notifications are still delivered, and the Data explorer and the System screen report live updates and machine events as unavailable.

## What Changes

- **What the check is.** Each check asks whether the subscription is still in place: read by its ID, or, when that read is refused (401 or 403), found in the broker's list of subscriptions, or else accepted when renewed.
- **When it is failed.** A refused read by ID alone is no failure. A subscription is reported as failed only when it can be neither read, found in the list, nor renewed, or when it is gone and can't be created again. The reason gives the HTTP status of the last of these answers, and never the broker's message, which can quote the token-bearing endpoint.
- **When it is gone.** A subscription that isn't in the list, or that a renewal answers as not found, is created again, as the existing requirements say. A refused read by ID is not taken as "gone", since the broker gives it for any ID.
- **Delivery status of the machine watch.** When the read by ID is refused, the broker's `notification.status` is read from the list entry, so `delivery_failing` is still reported where the broker includes it there. The platform's broker doesn't, so there it can't be seen while the read by ID is refused, as today.
- **No retries of the refused read on every tick.** A check that has found the subscription in place counts as done for the minute, whichever way it was found.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `backend/live-updates`: how the subscription is checked, and when it counts as failed or gone.
- `backend/machine-events`: the same for the machine-watch subscription. The "Refused" scenario of "The subscription" no longer applies to a refused read by ID alone.

## Impact

- **`backend/`:** `app/ngsi/live.py` (the live-update subscription's check) and `app/events/subscription.py` (the machine watch's check), with tests in `tests/test_live_updates.py` and `tests/test_events.py`.
- **Frontend:** nothing changes. The Data explorer and the System screen show the state the backend reports.
- **Dependencies:** none.
- **`architecture.md`:** no section is affected. The live updates and machine events it describes stay the same; only how their subscriptions are checked changes.

## Out of Scope

- **The broker's authorisation.** Why the broker refuses the read by ID, and changing its role setup.
- **Delivery failures from other fields.** Taking failing delivery from fields such as `timesFailed`, where the broker's list leaves out `notification.status`.
- **Other broker calls.** The sweep of subscriptions an earlier process left, creation and deletion keep their current requests.
- **The frontend indicator.** How the Data explorer shows the state, which #81 settled.
- **RAG**, as set out in #18.
