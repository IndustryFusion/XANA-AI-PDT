# Design

## Context

`GET /api/ngsi/attr-status` returns, per top-level attribute, whether its latest row in the time series is deleted and its observation time. It reads the `attributes` table ordered by attribute and time, newest first, and moves to the next attribute after each one's first row. The explorer uses the result only to offer the history of an attribute that has recorded rows.

Rows carry a `datasetId`, with `@none` for the default instance. The time series and the broker write observation times in different notations (`+00:00` and `Z`).

## Goals / Non-Goals

**Goals:**
- Tell the operator when the value shown isn't what the time series holds as the latest, per instance.
- Keep the attribute-level state as it is, for the history and for clients that read it.

**Non-Goals:**
- Sub-attributes, which the latest-state read doesn't cover.
- Changing the history's deleted notice.
- Repairing either store.

## Decisions

### D1: The latest state per instance, beside the attribute-level one

Each attribute's entry gains `datasets`, the latest `{deleted, observedAt}` of each instance keyed by dataset, with `@none` for the default instance. Its own `deleted` and `observedAt` stay the latest row of any instance.

The read orders by attribute, dataset and time, newest first, and moves past each instance after its first row. The keyset is `(attributeId, datasetId)`: `attributeId > a, or attributeId = a and datasetId > d`. This way an instance with many rows doesn't fill the pages before the next instance is reached.

*Alternatives:*
- One read per attribute. It needs as many requests as there are attributes.
- Offsets over all rows. It reads every row of the history.
- Keying the state by dataset only. It breaks the clients that read the attribute-level state.

### D2: Compare each instance with its own dataset, as instants

A line compares its instance's `observedAt` with `datasets[datasetId ?? '@none']`. Without `datasets`, it falls back to the attribute-level state. The state is:
- *deleted* when that instance is recorded as deleted;
- *newer* when its recorded time is later than the one shown, both parsed as instants;
- otherwise nothing, including when either time is missing.

*Alternatives:*
- Comparing the time strings. That can misjudge the same time written in two notations.
- Comparing with the attribute-level state. That lets another instance's deletion mark this one.

### D3: A small mark beside the value, and the value faint

The mark is a ⚠ in the warning tone, right after the value, with the explanation as its tooltip. It is focusable and labelled with the same text for screen readers. The value, its unit and its observation time are shown at reduced opacity. The rest of the line keeps its look and its actions.

*Alternatives:*
- A text badge. It takes much of the line, and the tooltip carries the explanation anyway.
- Dimming the whole line. Name and actions would look disabled.

### D4: Read the state again after a save

The time series records a save asynchronously. Two seconds after a save, the entity node reads the latest state again, so the mark follows the save without a reload.

*Alternatives:*
- Polling. It makes requests while nothing changes.
- Reading the state on every live update. That reads it for every device update.

## Risks / Trade-offs

- [The time series may lag the broker for a moment after a write] → The mark only shows when the time series is ahead, never when it lags.
- [Sub-attributes are not compared] → Out of scope. The latest-state read covers top-level attributes only.
