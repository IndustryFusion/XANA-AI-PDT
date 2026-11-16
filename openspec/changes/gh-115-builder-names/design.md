# Design

## Context

`dataspace.resolveBuilders(machineIds)` answers `{ [machineId]: builderName }` for the machines the registry knows, through `POST /api/ifric/resolve-builders`. The open-runs list shows `machineBuilder` for an escalated run, which is the recipient stored with the run. The incident history shows no builder.

## Goals / Non-Goals

**Goals:** the builder in both lists without opening a run; no extra request per row; no change when the registry can't answer.

**Non-Goals:** caching across screens; filtering by builder.

## Decisions

### D1: One shared hook, one request per list

`useBuilderNames(machineIds)` in `app/machineNames.js`, next to `useMachineNames`, takes the list's machine IDs, removes duplicates and empty IDs, sorts them, and calls `resolveBuilders` once. It returns the map only after a successful answer, and an empty map while loading or after an error. Sorting keeps the request the same when the list's order changes. The history passes the machines of all its incidents, not of the filtered ones, so a filter change sends no lookup. While a lookup for another set of machines loads, the hook keeps the map it has, which is keyed by machine, so rows don't lose their builders meanwhile; after an error it returns nothing.

*Alternative:* resolve the builder per row. That's one request per row and a flicker per row.

### D2: The escalation's recipient comes first

For an escalated run, the stored `machineBuilder` is who the incident went to, so it stays first: its name, then the registry's name, then its ID. For any other run, only the registry's name is shown.

*Alternative:* always show the registry's name. It could differ from the recipient of an escalation, and the row would then name the wrong party.

### D3: Nothing shown without an answer

When the registry is unavailable or still loading, no builder is shown, and nothing else in the row changes. There's no placeholder and no error in the list: the registry's state is the `ifric` check of the System area's health report.

### D4: The builder lookup is bounded like the name lookups

`RegistryClient.builders` asks each machine within `LOOKUP_REQUEST_S`, ends all of it within `NAMES_WITHIN_S`, and doesn't ask while the registry is down, as `machine_names` does. Until now it served callers that could wait; on a list, a hanging registry would otherwise hold the request for ten seconds per batch, and each timeout pauses the name lookups on every screen.

*Alternative:* keep the per-request timeout and rely on the frontend's request timeout. The backend would keep asking the registry after the page gave up.

## Risks / Trade-offs

- A builder's name is looked up when a list opens, so a renamed builder shows its new name, while the escalation's recipient keeps the name it had then. That is intended (D2).
