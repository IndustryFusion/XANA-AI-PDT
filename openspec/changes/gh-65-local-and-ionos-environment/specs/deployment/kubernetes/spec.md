# Spec Delta

## ADDED Requirements

### Requirement: The localAndIonos environment
Helmfile SHALL offer the environment `localAndIonos`, layered `default.yaml`, `production.yaml`, then `localAndIonos.yaml`, with no secret in its file and every value not yet known marked as a placeholder.

#### Scenario: Renders with the layering
- **WHEN** `helmfile -e localAndIonos template` runs
- **THEN** it renders, a value set in `localAndIonos.yaml` wins over the same value in `production.yaml` and `default.yaml`, and a value it doesn't set is production's

#### Scenario: No secret
- **WHEN** the environment is rendered with a secret from an `XANA_*` shell variable
- **THEN** the secret is only in the Secret, never in a ConfigMap, and the environment's file holds none

#### Scenario: Placeholders
- **WHEN** the environment's file is read
- **THEN** every value not yet given is under the reserved `.invalid` domain or named `replace-me`, with a comment saying what goes there, and the README lists them

#### Scenario: Checked in CI
- **WHEN** CI checks the chart
- **THEN** it renders `localAndIonos` with the other environments and runs the secret check on it
