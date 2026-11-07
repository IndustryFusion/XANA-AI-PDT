# Spec Delta

## ADDED Requirements

### Requirement: Automatic archive in the chart
The chart SHALL pass `AUTO_ARCHIVE_AFTER_S` to the backend as configuration.

#### Scenario: Rendered
- **WHEN** the chart is rendered with a value for the delay
- **THEN** the backend's configuration holds `AUTO_ARCHIVE_AFTER_S` with that value, and without one the backend's default applies
