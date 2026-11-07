# Spec Delta

## ADDED Requirements

### Requirement: Optional registry stub
The local environment SHALL offer a stub of the registry's routes under a profile.

#### Scenario: Started with the profile
- **WHEN** the environment is started with the profile `ifric`
- **THEN** the routes the backend uses answer as the registry does, for the sample machines

#### Scenario: Without the profile
- **WHEN** the environment is started without it
- **THEN** no stub runs, and the backend reports the registry as not configured
