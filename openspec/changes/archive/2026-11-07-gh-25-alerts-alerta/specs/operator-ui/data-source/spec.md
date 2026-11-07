# Spec Delta

## ADDED Requirements

### Requirement: Alerts from the backend
The backend data source SHALL serve the `alerts` area from the backend, with results in the documented shapes.

#### Scenario: Alerts on real data
- **WHEN** an operator uses the Alerts screen on the backend data source
- **THEN** it shows and changes what Alerta holds, including the severity bar, filters, bulk actions, detail and automatic refresh

#### Scenario: Partial failure of a bulk action
- **WHEN** an action fails for some selected alerts
- **THEN** those stay selected with the reason from the backend
