# backend/service-runtime Specification

## Purpose
Defines how the backend service is configured, which language model it uses, how it keeps secrets out of its output, and how it reports the health of its dependencies, including when some of them are not running.

## Requirements

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
The backend SHALL NOT include secret settings (passwords, API keys, tokens) in any response, log line or error message, including tokens carried in the addresses of subscriptions.

#### Scenario: Secret in a connection address
- **WHEN** a dependency whose configured address contains a password fails its health check
- **THEN** the reported detail and the log show the address with the password masked

#### Scenario: Configuration error
- **WHEN** the backend refuses to start because of an invalid secret setting
- **THEN** the message names the variable but not its value

#### Scenario: Token in a subscription address
- **WHEN** a subscription is created, renewed or fails, at any log level
- **THEN** the token appears in no log line, response or error message

#### Scenario: Library log line
- **WHEN** a library logs an address with a password or a bearer token
- **THEN** the log shows it masked

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

### Requirement: Starts without its dependencies
The backend SHALL start and serve its health report even when some or all of its dependencies are unreachable.

#### Scenario: Nothing reachable
- **WHEN** the backend starts while the memory database, time-series store, context broker and language model are all unreachable
- **THEN** it starts, and the health report shows every check as `error`

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

### Requirement: Database TLS settings
The backend SHALL apply a configured TLS mode and root certificate to its database connections, without overriding what a database URL already states.

#### Scenario: TLS required
- **WHEN** `POSTGRES_SSLMODE=require` is set
- **THEN** connections to the memory database and the time-series store use that mode

#### Scenario: URL already states a mode
- **WHEN** a database URL already has an `sslmode`
- **THEN** the URL keeps it

### Requirement: Liveness route
The backend SHALL answer a liveness route whether or not its dependencies are reachable, without checking them.

#### Scenario: Dependencies down
- **WHEN** no dependency can be reached, and a client requests the liveness route
- **THEN** it answers success at once

### Requirement: Encryption key for the gateway
A backend with `GATEWAY_URL` SHALL have a valid `SETTINGS_ENCRYPTION_KEY`.

#### Scenario: Missing key
- **WHEN** the backend starts with `GATEWAY_URL` and no key
- **THEN** it stops with a message naming `SETTINGS_ENCRYPTION_KEY` and how to make one

#### Scenario: Invalid key
- **WHEN** the key is not a valid key
- **THEN** it stops with a message naming the variable, never its value

#### Scenario: No gateway
- **WHEN** the backend starts without `GATEWAY_URL`
- **THEN** it needs no key

#### Scenario: Secrets are masked
- **WHEN** the secret or the key would appear in a log
- **THEN** it is masked

### Requirement: Dataspace health
The health report SHALL include `gateway` and `connector` checks.

#### Scenario: Gateway up
- **WHEN** the gateway answers its health route and the token is accepted
- **THEN** both checks are `ok`, and the connector's detail says how far it could check

#### Scenario: Gateway down
- **WHEN** the gateway can't be reached
- **THEN** `gateway` is `error`

#### Scenario: Not connected
- **WHEN** the gateway is up and there is no valid token
- **THEN** `gateway` is `ok`, and `connector` is `degraded`, saying that the backend is not connected

#### Scenario: Adapter failing
- **WHEN** the gateway is up and an authenticated read answers `503`
- **THEN** `connector` is `error`

#### Scenario: Dataspace not configured
- **WHEN** no gateway is configured
- **THEN** both are `ok`, saying so, and the overall state is unchanged

### Requirement: Registry health
The health report SHALL include an `ifric` check, for which `401` and `403` are failures.

#### Scenario: Works
- **WHEN** the registry answers for the own company with the dataspace token
- **THEN** the check is `ok`

#### Scenario: Refused
- **WHEN** it answers `401` or `403`
- **THEN** the check is `error`, saying that the registry refused the token

#### Scenario: Down
- **WHEN** it can't be reached or fails
- **THEN** the check is `error`

#### Scenario: No token
- **WHEN** the backend isn't connected to the dataspace
- **THEN** the check is `degraded`, saying so

#### Scenario: Not configured
- **WHEN** `IFRIC_URL` is not set
- **THEN** the check is `ok`, saying so, and doesn't count towards the overall state

### Requirement: Machine events in the health report
The health report SHALL have a `machine_events` check, with the subscription's state in its detail.

#### Scenario: States
- **WHEN** the state is `active`, `waiting_for_identity`, `delivery_failing`, `no_delivery_in_tenant` or `failed`
- **THEN** the check is `ok`, `degraded`, `degraded`, `degraded` or `error`

#### Scenario: A service identity that fails
- **WHEN** the check is waiting for an identity, and the service identity failed
- **THEN** the detail says why, naming no secret

#### Scenario: Not configured
- **WHEN** the state is `not_configured`
- **THEN** the check is `ok`, says so, and doesn't count towards the overall result

### Requirement: The new secrets stay secret
`EVENT_WEBHOOK_SECRET`, `KEYCLOAK_SERVICE_CLIENT_SECRET` and the service identity's token SHALL be in no response, log or error message.

#### Scenario: Refused by the broker
- **WHEN** the broker's answer quotes the subscription
- **THEN** neither the log nor the health report holds the secret

#### Scenario: Settings incomplete
- **WHEN** `CALLBACK_BASE_URL` is set without `EVENT_WEBHOOK_SECRET`, or only one of the service client's two settings is set
- **THEN** the backend stops, with a message naming the variable, never a value

### Requirement: Every connection in the health report
The health report SHALL hold checks for `memory`, `timeseries`, `broker`, `llm`, `alerta`, `mqtt`, `pgrest`, `gateway`, `dataspace_connector`, `ifric`, `fuseki` and `machine_events`, each with its probe address, with any password masked, and a hint of what to look at.

#### Scenario: One service stops
- **WHEN** any one service stops
- **THEN** only its own check is `error`, the report still answers, and the rest of the app keeps working

#### Scenario: What depends on a stopped service
- **WHEN** the context broker stops
- **THEN** the `broker` check is `error`, and `machine_events`, which follows from it, is `degraded`

#### Scenario: Refused
- **WHEN** a service answers 401 or 403
- **THEN** its check is `error`, and says it was refused

#### Scenario: An empty ontology
- **WHEN** Fuseki answers, and the dataset holds nothing
- **THEN** the check is `degraded`, and says so

#### Scenario: MQTT with nobody signed in
- **WHEN** sign-in is on, and nobody is signed in
- **THEN** the MQTT check is `degraded` if the broker can be reached, as credentials can't be checked

#### Scenario: Refused MQTT credentials
- **WHEN** the MQTT broker refuses the credentials
- **THEN** the check is `error`

#### Scenario: No secret
- **WHEN** an address holds a password, in its query too under a name with password, token, key or secret, or a service needs a key
- **THEN** neither is in the report

### Requirement: Service settings
`GET /api/config` SHALL give the service addresses in use, read-only, and no route SHALL take the address of a service the backend calls.

#### Scenario: Read
- **WHEN** a client asks for the settings
- **THEN** each has a key, a label and the address in use, with any password masked, and is marked as not editable

#### Scenario: A change
- **WHEN** a client sends anything to `/api/config` with another method
- **THEN** it is refused, and nothing changes

### Requirement: Why the dataspace is not connected
When the backend is not connected to a configured dataspace, the `dataspace_connector` check SHALL say why the last attempt failed, and whether the backend is still trying, without addresses, tokens or secrets.

#### Scenario: Still trying
- **WHEN** connecting at startup failed because the dataspace can't be reached
- **THEN** `dataspace_connector` is `degraded`, and its detail gives the reason and says that the backend tries again

#### Scenario: Stopped trying
- **WHEN** connecting failed because the credential was rejected
- **THEN** `dataspace_connector` is `degraded`, and its detail says that the credential was rejected and that the backend does not try again by itself

#### Scenario: Connected afterwards
- **WHEN** a later attempt succeeds
- **THEN** the detail no longer names the earlier failure

### Requirement: Automatic archive setting
The backend SHALL read `AUTO_ARCHIVE_AFTER_S`, a whole number of seconds, 3600 by default, where `0` turns automatic archiving off.

#### Scenario: Default
- **WHEN** the setting is not given
- **THEN** finished runs are archived automatically after 3600 seconds

#### Scenario: Invalid value
- **WHEN** the value is negative or not a whole number
- **THEN** the backend stops at startup with a message naming `AUTO_ARCHIVE_AFTER_S`

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
