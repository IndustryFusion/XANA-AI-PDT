# deployment/kubernetes Specification

## Purpose
Defines how XANA AI PDT is built into images, installed on a Kubernetes cluster next to the digital twin platform, and given its configuration and secrets.

## Requirements

### Requirement: Frontend image
The project SHALL provide a frontend image that serves the UI on the backend data source, and proxies API and stream requests to a backend address given at start.

#### Scenario: Requests reach the backend
- **WHEN** the image runs with a backend address, and a client requests `/api/diagnostics`
- **THEN** the backend answers through the frontend's address

#### Scenario: Run stream and live updates
- **WHEN** a client opens a WebSocket on `/ws/run/{id}` or `/api/ngsi/ws` through the frontend's address
- **THEN** the connection is forwarded to the backend

#### Scenario: Long calls and uploads
- **WHEN** a backend call takes up to 300 seconds, or a request body is up to 64 MB
- **THEN** the frontend's proxy does not cut it off

#### Scenario: Screen addresses
- **WHEN** a browser opens the address of a screen directly
- **THEN** the UI is served and shows that screen

### Requirement: Backend image for production
The project SHALL provide a backend image that runs as a non-root user, and does not reload on code changes unless configured to.

#### Scenario: Non-root start
- **WHEN** the image starts with default settings
- **THEN** the process runs as a non-root user, and no development reload is active

### Requirement: Installable chart
The project SHALL provide a Helm chart and Helmfile that install the frontend and backend with their Services, configuration, Ingress, probes and resources, with default addresses for the platform's in-cluster services.

#### Scenario: Fresh install
- **WHEN** an operator follows the documented steps on a cluster running the platform
- **THEN** every Pod reaches ready, and the health report shows the connections

#### Scenario: Default addresses
- **WHEN** the chart is rendered with default values
- **THEN** it uses `scorpio-all-in-one-runner:9090`, `acid-cluster:5432/tsdb` and `acid-cluster:5432/memory`

#### Scenario: Runs through the Ingress
- **WHEN** a client starts a run through the Ingress and opens its live stream
- **THEN** the run's steps arrive on the stream

#### Scenario: Restart keeps data
- **WHEN** the backend Pod restarts
- **THEN** runs and incidents are still there

#### Scenario: One backend replica
- **WHEN** the chart is rendered
- **THEN** it runs one backend replica, because runs are held in the process

### Requirement: Secrets from defined sources
The chart SHALL take secrets from an existing Secret if one is named, otherwise take database credentials from the database operator's Secret, and take other values supplied at install time. Secrets SHALL NOT appear in a ConfigMap or in the repository.

#### Scenario: Existing Secret
- **WHEN** `secrets.existingSecret` is set
- **THEN** the backend reads its secrets from that Secret, and the chart creates no Secret

#### Scenario: Operator credentials
- **WHEN** no existing Secret is named and the operator's Secret is configured
- **THEN** the database URLs are built from the user and password in that Secret

#### Scenario: Install-time values
- **WHEN** other secret values are supplied at install time
- **THEN** they are stored in a Secret the chart creates, and never in a ConfigMap

#### Scenario: Nothing committed
- **WHEN** the repository is searched
- **THEN** it holds no credentials and no environment-specific hosts

### Requirement: Images built in CI
Every Pull Request that changes an image or the chart SHALL build both images and check the chart. Images SHALL be published only from a version tag.

#### Scenario: Pull Request
- **WHEN** a Pull Request changes the chart or an image's files
- **THEN** CI builds both images and checks the chart, without publishing anything

#### Scenario: Version tag
- **WHEN** a tag such as `v1.0.0` is pushed
- **THEN** CI publishes both images with that tag

### Requirement: Dataspace settings in the chart
The chart SHALL pass the gateway's settings as configuration, and `SETTINGS_ENCRYPTION_KEY` and `GATEWAY_CLIENT_SECRET` as secrets.

#### Scenario: Rendered
- **WHEN** the chart is rendered with a gateway address and keys from the environment
- **THEN** the addresses are in the configuration, the key and secret only in the Secret

### Requirement: Registry address in the chart
The chart SHALL pass `IFRIC_URL` when it is set.

#### Scenario: Rendered
- **WHEN** the chart is rendered with a registry address
- **THEN** it is in the configuration, including its port

### Requirement: Machine events settings
The chart SHALL pass the machine events' settings, with the secrets kept apart from the ConfigMap.

#### Scenario: Secrets
- **WHEN** `EVENT_WEBHOOK_SECRET` or `KEYCLOAK_SERVICE_CLIENT_SECRET` is supplied
- **THEN** it is in a Secret, and in no ConfigMap

#### Scenario: Address
- **WHEN** `callbackBaseUrl` is set
- **THEN** the backend receives it as `CALLBACK_BASE_URL`, and with it unset no subscription is made

### Requirement: Automatic archive in the chart
The chart SHALL pass `AUTO_ARCHIVE_AFTER_S` to the backend as configuration.

#### Scenario: Rendered
- **WHEN** the chart is rendered with a value for the delay
- **THEN** the backend's configuration holds `AUTO_ARCHIVE_AFTER_S` with that value, and without one the backend's default applies

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
