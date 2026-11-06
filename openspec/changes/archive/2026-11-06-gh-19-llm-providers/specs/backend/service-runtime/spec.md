# Spec Delta

## MODIFIED Requirements

### Requirement: Language model selection
The backend SHALL create its language model from configuration. Local Ollama is the default. Anthropic and OpenAI are also selectable, as are OpenAI-compatible servers such as OpenVINO Model Server through a base address, and a scripted provider that gives fixed answers without any model. Changing provider SHALL require no code change.

#### Scenario: Default provider
- **WHEN** no provider is configured
- **THEN** the backend uses the configured model on the local Ollama server

#### Scenario: Switch provider
- **WHEN** the operator of the deployment sets the provider to `anthropic` with a model name and API key
- **THEN** the backend uses that provider after a restart

#### Scenario: Missing key for a cloud provider
- **WHEN** a cloud provider is selected without its API key
- **THEN** the backend does not start and names the missing variable

#### Scenario: OpenAI-compatible server
- **WHEN** the provider is `openai` with a base address and no API key
- **THEN** the backend starts and sends its model calls to that address

#### Scenario: Scripted provider
- **WHEN** the provider is set to `scripted`
- **THEN** the backend answers model requests with fixed, valid answers and makes no network request to any model provider

### Requirement: Dependency health
The backend SHALL report the health of each dependency: memory database, time-series store, NGSI-LD context broker and language model. Each report has a status (`ok`, `degraded`, `error`), its latency and a short detail. The overall status is `ok` when all dependencies are ok, `error` when all fail, and `degraded` otherwise.

#### Scenario: All dependencies reachable
- **WHEN** a client requests the health report and every dependency answers
- **THEN** every check is `ok` with its latency, and the overall status is `ok`

#### Scenario: Model list
- **WHEN** a client requests the health report
- **THEN** it lists the agent's model with its name, role and availability, and the language model check names the provider's display name when one is configured

#### Scenario: Model not available
- **WHEN** the model server cannot be reached, or does not have the configured model
- **THEN** the model is listed as not available, and the language model check says why

#### Scenario: One dependency down
- **WHEN** the context broker cannot be reached
- **THEN** its check is `error` with a detail saying it could not be reached, the other checks are unaffected, and the overall status is `degraded`

#### Scenario: Slow dependency
- **WHEN** a dependency does not answer within the configured check timeout
- **THEN** its check is `error` with a timeout detail, and the health report still answers within the timeout plus a small margin

#### Scenario: Cached and fresh report
- **WHEN** a client requests the health report twice within the cache period without asking for a fresh check
- **THEN** the second answer is the cached report with its original check time; asking for a fresh check runs the checks again

## ADDED Requirements

### Requirement: Local model settings
The backend SHALL send a local model the configured context size, SHALL give it the expected answer structure, SHALL accept an answer given as content or as a tool call, and SHALL turn reasoning off.

#### Scenario: Long prompt
- **WHEN** a prompt longer than the local model server's default context is sent
- **THEN** the model receives it in full, up to the configured context size

#### Scenario: Answer as a tool call
- **WHEN** a local model gives its structured answer as a tool call with empty content
- **THEN** the answer is used as if it had been given as content

### Requirement: Optional tracing
The backend SHALL trace model calls with their run when tracing is configured, and SHALL work unchanged when it is not configured or its package is not installed.

#### Scenario: Not configured
- **WHEN** no tracing keys are set
- **THEN** no tracing happens and no tracing package is needed

#### Scenario: Configured without the package
- **WHEN** tracing keys are set and the tracing package is not installed
- **THEN** the backend starts, logs a warning, and runs work without tracing

#### Scenario: Configured
- **WHEN** tracing is configured and a run's round executes
- **THEN** its model calls are traced with the run identifier, the machine and the round
