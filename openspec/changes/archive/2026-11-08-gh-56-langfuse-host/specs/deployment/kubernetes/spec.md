# Spec Delta

## ADDED Requirements

### Requirement: Tracing address in the chart
The chart SHALL pass the Langfuse address to the backend as configuration, and the Langfuse keys as secrets.

#### Scenario: Rendered with an address and keys
- **WHEN** the chart is rendered with a Langfuse address and keys
- **THEN** the backend's configuration holds `LANGFUSE_HOST` with the address, and the keys are only in the Secret

#### Scenario: Rendered without an address
- **WHEN** no address is given
- **THEN** no `LANGFUSE_HOST` is rendered

#### Scenario: Traces through the chart
- **WHEN** the backend runs with the configuration and Secret the chart renders with an address and keys
- **THEN** traces reach that address (test with a stand-in server)
