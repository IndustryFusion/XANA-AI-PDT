# Proposal

Issue: #115

## Why

The open-runs list names a machine builder only once a run has been escalated, and the incident history names none (#115). The registry already knows each machine's builder: the escalation preflight reads it, and the data interface offers `dataspace.resolveBuilders`. An operator scanning the lists therefore can't see who builds a machine before escalating, although that is often what decides whether to escalate.

## What Changes

- **Open runs:** a run that has not been escalated names its machine's builder from the registry, when the registry knows one. An escalated run keeps naming the recipient it was escalated to, and its ID when no name is known.
- **Incident history:** each past incident names its machine's builder from the registry, when the registry knows one.
- **One lookup per list:** each list resolves the builders of its machines in one request, not one per row; the history asks for all its machines, so a filter change asks nothing. Before the first answer, or when the registry is unavailable, the lists show no builder and work as before; while a new lookup loads, the builders already known stay.
- **A bounded lookup:** the backend's builder lookup, until now used where it could wait, is bounded like the name lookups, as both lists now call it.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `operator-ui/active-incidents`: *Machine builder per row*.
- `operator-ui/incident-history`: a new requirement, *Machine builder per incident*.

## Out of Scope

- Filtering or searching the lists by machine builder.
- Builder names anywhere else, such as the run view or the dashboard.
- Caching builders across requests, and lists of more than 200 machines, which the lookup refuses as it does for machine names.

## Impact

Frontend: a shared hook for the lookup, the two list screens, their tests, and one end-to-end test whose viewport needs room for the extra line. Backend: `RegistryClient.builders` in `app/ifric.py` and its test.
