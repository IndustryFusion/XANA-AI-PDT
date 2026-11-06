# Spec Delta

## MODIFIED Requirements

### Requirement: Model failure
When the language model does not answer within its timeout, or gives an answer that does not match the expected structure on the first try and on three retries, the round SHALL fail with the failing step and a readable reason.

#### Scenario: Timeout
- **WHEN** the model does not answer during the validate step within the timeout
- **THEN** the outcome is failed, with step `validate` and a reason that names the timeout

#### Scenario: Malformed answer
- **WHEN** the model's first answer in a step does not match the expected structure
- **THEN** the step asks again, up to three times. If an answer matches, the round continues; otherwise it fails with that step and a reason that says the structure did not match.
