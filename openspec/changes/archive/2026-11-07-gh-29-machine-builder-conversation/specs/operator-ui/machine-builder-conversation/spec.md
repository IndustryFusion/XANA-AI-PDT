# Spec Delta

## MODIFIED Requirements

### Requirement: Policy-gated data requests
When the machine builder requests data, the conversation SHALL show whether the request is within the configured data-sharing tier, and every request SHALL wait for the operator's decision.

#### Scenario: Request within the tier
- **WHEN** the machine builder requests data within the tier
- **THEN** the run moves to `awaiting_operator_approval`, the request shows as within the tier, and nothing is sent until the operator approves

#### Scenario: Request beyond the tier
- **WHEN** the machine builder requests data beyond the tier
- **THEN** the run moves to `awaiting_operator_approval` and nothing beyond the tier is sent until the operator approves
