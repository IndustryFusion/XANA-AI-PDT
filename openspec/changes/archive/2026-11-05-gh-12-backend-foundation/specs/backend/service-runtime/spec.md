## ADDED Requirements

### Requirement: Configuration from the environment
The backend SHALL read all of its configuration from environment variables, with a documented default for every non-secret setting, and SHALL refuse to start when a setting is invalid.

#### Scenario: Start with defaults
- **WHEN** the backend starts with only the documented required variables set
- **THEN** it starts and uses the documented defaults for every other setting

#### Scenario: Invalid setting
- **WHEN** the backend starts with a setting that cannot be used (for example a confidence threshold of `1.5` or an unknown language model provider)
- **THEN** it does not start, and its output names the variable and the reason

#### Scenario: Documented variables
- **WHEN** a contributor reads the backend's example environment file
- **THEN** every variable the backend reads is listed with its meaning and default, and secret variables have no real value

### Requirement: Secrets stay secret
The backend SHALL NOT include secret settings (passwords, API keys, tokens) in any response, log line or error message.

#### Scenario: Secret in a connection address
- **WHEN** a dependency whose configured address contains a password fails its health check
- **THEN** the reported detail and the log show the address with the password masked

#### Scenario: Configuration error
- **WHEN** the backend refuses to start because of an invalid secret setting
- **THEN** the message names the variable but not its value

### Requirement: Language model selection
The backend SHALL create its language model from configuration. Local Ollama is the default. Anthropic and OpenAI are also selectable, as is a scripted provider that gives fixed answers without any model. Changing provider SHALL require no code change.

#### Scenario: Default provider
- **WHEN** no provider is configured
- **THEN** the backend uses the configured model on the local Ollama server

#### Scenario: Switch provider
- **WHEN** the operator of the deployment sets the provider to `anthropic` with a model name and API key
- **THEN** the backend uses that provider after a restart

#### Scenario: Missing key for a cloud provider
- **WHEN** a cloud provider is selected without its API key
- **THEN** the backend does not start and names the missing variable

#### Scenario: Scripted provider
- **WHEN** the provider is set to `scripted`
- **THEN** the backend answers model requests with fixed, valid answers and makes no network request to any model provider

### Requirement: Dependency health
The backend SHALL report the health of each dependency: memory database, time-series store, NGSI-LD context broker and language model. Each report has a status (`ok`, `degraded`, `error`), its latency and a short detail. The overall status is `ok` when all dependencies are ok, `error` when all fail, and `degraded` otherwise.

#### Scenario: All dependencies reachable
- **WHEN** a client requests the health report and every dependency answers
- **THEN** every check is `ok` with its latency, and the overall status is `ok`

#### Scenario: One dependency down
- **WHEN** the context broker cannot be reached
- **THEN** its check is `error` with a detail saying it could not be reached, the other checks are unaffected, and the overall status is `degraded`

#### Scenario: Slow dependency
- **WHEN** a dependency does not answer within the configured check timeout
- **THEN** its check is `error` with a timeout detail, and the health report still answers within the timeout plus a small margin

#### Scenario: Cached and fresh report
- **WHEN** a client requests the health report twice within the cache period without asking for a fresh check
- **THEN** the second answer is the cached report with its original check time; asking for a fresh check runs the checks again

### Requirement: Starts without its dependencies
The backend SHALL start and serve its health report even when some or all of its dependencies are unreachable.

#### Scenario: Nothing reachable
- **WHEN** the backend starts while the memory database, time-series store, context broker and language model are all unreachable
- **THEN** it starts, and the health report shows every check as `error`
