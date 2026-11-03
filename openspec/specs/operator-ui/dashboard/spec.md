# operator-ui/dashboard Specification

## Purpose
Gives operators a single overview of the plant's diagnostic situation (open incidents, alerts, data, dataspace and system health) and a starting point into each area.

## Requirements

### Requirement: Overview tiles
The dashboard SHALL show one tile each for active incidents, open alerts, data overview, dataspace and system health.

#### Scenario: Dashboard with data
- **WHEN** the operator opens the dashboard and all areas return data
- **THEN** five tiles are shown: active incidents with count and the most recent entries with their status, open alerts with counts per severity, data overview with entity and type counts, dataspace with connection state and number of compatible peers, and system health with the state of each dependency

### Requirement: Tiles link to their areas
Each tile SHALL lead to its area, and an entry shown inside a tile SHALL lead to that item.

#### Scenario: Open an incident from the dashboard
- **WHEN** the operator selects an incident listed in the active-incidents tile
- **THEN** the Active incidents area opens with that run selected

#### Scenario: Open an area from a tile
- **WHEN** the operator selects the header of a tile
- **THEN** the corresponding area opens

### Requirement: Independent tile states
Each tile SHALL load, fail and show emptiness independently of the other tiles.

#### Scenario: One area fails
- **WHEN** the alerts area fails and the other areas return data
- **THEN** the alerts tile shows an error state with a retry action and the other tiles show their data

#### Scenario: Nothing yet
- **WHEN** there are no active incidents
- **THEN** the active-incidents tile shows an empty state inviting the operator to start an analysis, which opens the new-incident form

#### Scenario: Dataspace not connected
- **WHEN** the dataspace is not connected
- **THEN** the dataspace tile states this and offers to open the Dataspace area to connect

### Requirement: Refresh
The dashboard SHALL refresh its tiles periodically at an interval the operator can choose, including switching automatic refresh off.

#### Scenario: Change refresh interval
- **WHEN** the operator selects a different refresh interval
- **THEN** the tiles refresh at that interval and the choice is kept after a reload

#### Scenario: Refresh off
- **WHEN** the operator switches automatic refresh off
- **THEN** the tiles only change after a manual refresh
