# Spec Delta

## MODIFIED Requirements

### Requirement: Live updates
The Data explorer SHALL show attribute changes as they happen when live updates are on, highlight changed values briefly, and indicate whether live updates are working. When they stop working, it SHALL recover by itself once they work again.

#### Scenario: Value changes live
- **WHEN** live updates are on and a shown attribute changes
- **THEN** the new value appears without a reload and is highlighted briefly

#### Scenario: Live updates unavailable
- **WHEN** live updates cannot be delivered
- **THEN** the indicator says so and the explorer keeps working without them

#### Scenario: Live updates return
- **WHEN** live updates work again
- **THEN** the indicator shows it, and changes appear again with no reload
