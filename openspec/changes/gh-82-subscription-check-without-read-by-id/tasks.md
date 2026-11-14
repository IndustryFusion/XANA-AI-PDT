# Tasks

## 1. Live updates

- [ ] 1.1 Check the live-update subscription by ID, then by the list, then by a renewal, as the design sets out, and mark the minute at every answer. Verify with stub tests:
  - 403 to the read by ID with the subscription in the list stays `active` over several checks, with no PATCH or POST for it;
  - after a check that failed, a later check that finds the subscription in place makes the state `active` again;
  - an answer to the list that isn't a list of subscriptions goes on to the renewal;
  - read by ID and list refused, with the renewal accepted, stays `active`;
  - a subscription missing from the list is created again within a minute;
  - everything refused gives `subscription_failed`, with a reason naming the HTTP status and that access is lacking, and holding neither the broker's message, the endpoint nor a token, in the state or the log;
  - after a refused read, the next read comes a minute later, not at the next tick.

## 2. Machine watch

- [ ] 2.1 Check the machine-watch subscription by the same order, taking `notification.status` from the list entry when the read by ID is refused. Verify with stub tests:
  - only the read by ID refused stays `active` over several checks, also when the list is refused and the update accepted;
  - after `failed`, the next try that updates or creates the subscription makes the state `active` again;
  - missing from the list, or an update answered with 404, is created again;
  - `notification.status` `failed` in the list entry gives `delivery_failing`;
  - a list entry without `notification.status`, as the platform's broker gives, counts as delivering;
  - everything refused gives `failed`, with a reason naming the HTTP status and that the identity lacks access, without the broker's message or the secret;
  - a 404 to the read by ID is still created again.

## 3. Verification on the platform

- [ ] 3.1 Against the local environment's Scorpio, which answers 403 to the read by ID, sign in and watch `/api/ngsi/subscription-health` and the machine watch's health for at least five minutes, across a token rotation. Verify that the broker lists both subscriptions to the operator's token, that both stay `active`, and that the Data explorer's indicator shows working. This is also task 5.4 of the archived change `gh-81-explorer-compact-browsing`.
- [ ] 3.2 Delete the live-update subscription in the broker while live updates run, and then the machine-watch subscription (`CALLBACK_BASE_URL` is set in the local environment's default values). Verify that each is created again within a minute, that live updates continue, and that the machine watch's health is `active` again.

## Workflow follow-up

- Open the proposal-only Pull Request for this change, and implement only after `spec-approved`.
- Archive with `/opsx:archive gh-82-subscription-check-without-read-by-id` in a follow-up Pull Request after the merge.
