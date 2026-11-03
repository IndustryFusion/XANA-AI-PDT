# operator-ui/incident-history Specification

## Purpose
Gives operators access to past incidents (what happened, what was decided, what was exchanged with the machine builder and how the agent reasoned) and lets them reopen an incident.

## Requirements

### Requirement: Incident list
The Incident history area SHALL list past incidents newest first with machine, issue, outcome and date, searchable by text and filterable by machine, outcome and date range.

#### Scenario: Browse history
- **WHEN** the operator opens the Incident history area
- **THEN** past incidents are listed newest first with machine, issue, outcome label and date

#### Scenario: Filter by machine from an entity reference
- **WHEN** the operator chooses "show incident history" on an entity reference
- **THEN** the list shows only that machine's incidents and names the active filter with a way to clear it

#### Scenario: No matches
- **WHEN** no incident matches the search and filters
- **THEN** an empty state says so and offers to clear the filters

### Requirement: Incident detail
Selecting an incident SHALL show its issue, root cause, decision, resolution, machine-builder reference, conversation transcript and full agent trace, and update the URL to that incident.

#### Scenario: Open detail
- **WHEN** the operator selects an incident
- **THEN** the detail shows issue, root cause, decision, resolution, machine-builder reference when escalated, and the URL identifies the incident

#### Scenario: Agent trace
- **WHEN** the operator expands a trace step
- **THEN** the step's inputs and outputs are shown as labelled, structured fields

#### Scenario: Not escalated
- **WHEN** the incident was never escalated
- **THEN** no conversation section is shown and the detail says the incident was resolved without the machine builder

### Requirement: Reopen from history
The operator SHALL be able to reopen a past incident, which starts a new run in the Active incidents area.

#### Scenario: Reopen an incident
- **WHEN** the operator reopens a past incident and confirms
- **THEN** a new run starts, the Active incidents area opens with that run selected, and its conversation continues when one existed
