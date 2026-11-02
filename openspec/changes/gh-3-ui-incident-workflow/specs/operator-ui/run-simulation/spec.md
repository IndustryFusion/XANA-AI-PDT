# Spec Delta

## Purpose

Lets the mock data source play realistic diagnostic runs, so that every run state and every path of the incident workflow can be demonstrated and tested without a backend.

## ADDED Requirements

### Requirement: Simulated runs
On the mock data source, a started run SHALL progress through agent steps and states with realistic delays and emit the same run events that the UI data interface documents.

#### Scenario: Run progresses on its own
- **WHEN** a run is started on the mock data source
- **THEN** step events and status events arrive over time in the documented order until the run reaches a waiting or final state

### Requirement: Named scenarios
The mock data source SHALL provide named scenarios covering every run state: happy path, low confidence, rejected resolution, escalation within tier, request beyond tier, machine-builder recommendation, machine builder closes, stop and reopen, direct contact, failure, and degraded data.

#### Scenario: Each scenario reaches its documented end
- **WHEN** a run is started with a given scenario and the operator takes that scenario's actions
- **THEN** the run passes through the scenario's documented states and ends in its documented final or waiting state

#### Scenario: Degraded data
- **WHEN** the degraded-data scenario runs
- **THEN** the observe step reports which data source was unavailable and the run continues with partial data

### Requirement: Simulated machine builder
On the mock data source, the machine builder SHALL answer escalations and operator acts according to the running scenario, with realistic delays.

#### Scenario: Machine builder replies
- **WHEN** the operator sends a request in a scenario where the machine builder answers
- **THEN** a machine-builder reply arrives after a delay and the outgoing message's delivery status changes to delivered

### Requirement: Scenario and speed controls
In development builds the mock data controls SHALL let the operator choose the scenario for the next started run and the playback speed.

#### Scenario: Choose scenario
- **WHEN** the operator selects a scenario and starts a run
- **THEN** the run follows that scenario

#### Scenario: Faster playback
- **WHEN** the playback speed is increased
- **THEN** delays between simulated events shrink proportionally

### Requirement: Simulated connection loss
In development builds the mock data controls SHALL be able to interrupt a run's live connection, to demonstrate recovery.

#### Scenario: Interrupt and recover
- **WHEN** the connection of a waiting run is interrupted and the simulated machine builder replies meanwhile
- **THEN** after recovery the run view shows the reply and the run's current state
