# Spec Delta

## ADDED Requirements

### Requirement: Dataspace settings in the chart
The chart SHALL pass the gateway's settings as configuration, and `SETTINGS_ENCRYPTION_KEY` and `GATEWAY_CLIENT_SECRET` as secrets.

#### Scenario: Rendered
- **WHEN** the chart is rendered with a gateway address and keys from the environment
- **THEN** the addresses are in the configuration, the key and secret only in the Secret
