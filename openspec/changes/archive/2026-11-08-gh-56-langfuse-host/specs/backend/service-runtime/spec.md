# Spec Delta

## ADDED Requirements

### Requirement: Tracing address
The backend SHALL send traces to the address in `LANGFUSE_HOST` or `LANGFUSE_BASE_URL`, and SHALL send nothing when the tracing keys are not set.

#### Scenario: Address and keys
- **WHEN** the keys and an address are set, and a run's round calls the model
- **THEN** its traces reach that address (test with a stand-in server)

#### Scenario: Either name
- **WHEN** only `LANGFUSE_BASE_URL` is set, or only `LANGFUSE_HOST`
- **THEN** that address is used

#### Scenario: Two different addresses
- **WHEN** `LANGFUSE_HOST` and `LANGFUSE_BASE_URL` are set to different addresses
- **THEN** the backend stops at startup with a message naming both variables

#### Scenario: No keys
- **WHEN** an address is set and no keys
- **THEN** no trace is sent, and the stand-in server gets no request
