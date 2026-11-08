# Spec Delta

## ADDED Requirements

### Requirement: Automatic archive setting
The backend SHALL read `AUTO_ARCHIVE_AFTER_S`, a whole number of seconds, 3600 by default, where `0` turns automatic archiving off.

#### Scenario: Default
- **WHEN** the setting is not given
- **THEN** finished runs are archived automatically after 3600 seconds

#### Scenario: Invalid value
- **WHEN** the value is negative or not a whole number
- **THEN** the backend stops at startup with a message naming `AUTO_ARCHIVE_AFTER_S`
