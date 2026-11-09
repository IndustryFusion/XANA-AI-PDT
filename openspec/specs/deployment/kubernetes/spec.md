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
The project SHALL provide a Helm chart and Helmfile that install the frontend and backend with their Services, configuration, Ingress, probes and resources, in namespace `xana-pdt` by default, with default addresses for the platform's services in `platformNamespace`.

#### Scenario: Fresh install
- **WHEN** an operator follows the documented steps on a cluster running the platform
- **THEN** every Pod reaches ready, and the health report shows the connections

#### Scenario: Default addresses
- **WHEN** the chart is rendered with default values
- **THEN** it is in namespace `xana-pdt`, and uses `scorpio-all-in-one-runner.iff:9090`, `acid-cluster.iff:5432/tsdb` and `acid-cluster.iff:5432/memory`

#### Scenario: Runs through the Ingress
- **WHEN** a client starts a run through the Ingress and opens its live stream
- **THEN** the run's steps arrive on the stream

#### Scenario: Restart keeps data
- **WHEN** the backend Pod restarts
- **THEN** runs and incidents are still there

#### Scenario: One backend replica
- **WHEN** the chart is rendered
- **THEN** it runs one backend replica, because runs are held in the process

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

### Requirement: Build and push script
`build.sh` SHALL build the backend and frontend images and push them as `<REGISTRY>/xana-ai-pdt-<name>:<IMAGE_TAG>`, with `REGISTRY` defaulting to `k3d-iff.localhost:12345` and `IMAGE_TAG` to `latest`, taking shell variables before an optional, git-ignored `.env` at the repository root, read as data.

#### Scenario: Defaults
- **WHEN** `./build.sh` runs with no settings
- **THEN** both images are built and pushed to `k3d-iff.localhost:12345` with tag `latest`, and the registry, tag and image names are printed first

#### Scenario: Registry and tag from the shell
- **WHEN** `REGISTRY=<host>/<path> IMAGE_TAG=1.2.3 ./build.sh` runs against a registry
- **THEN** `<host>/<path>/xana-ai-pdt-backend:1.2.3` and `<host>/<path>/xana-ai-pdt-frontend:1.2.3` are in that registry

#### Scenario: Config file and shell
- **WHEN** `.env` sets the registry and tag, and the shell sets the tag too
- **THEN** the registry from the file and the tag from the shell are used

#### Scenario: A config file it can't read
- **WHEN** `.env` holds another key or a line that isn't `KEY=VALUE`
- **THEN** the script stops before building, naming the line, and nothing in the file runs

#### Scenario: Build only, and one image
- **WHEN** the script runs with `--no-push`, or with `backend` or `frontend`
- **THEN** nothing is pushed, or only that image is built

#### Scenario: Failures
- **WHEN** an option is unknown, or a build or a push fails
- **THEN** the script ends with a non-zero exit and says what failed

#### Scenario: The chart finds the images
- **WHEN** the chart is rendered with the same `imageRegistry` and `imageTag`
- **THEN** its images are exactly the pushed ones

#### Scenario: Checked in CI
- **WHEN** CI runs
- **THEN** it runs the script with `--no-push`, and shellcheck passes on it

### Requirement: The localAndIonos environment
Helmfile SHALL offer the environment `localAndIonos`, layered `default.yaml`, `production.yaml`, then `localAndIonos.yaml`, with no secret in its file and every value not yet known marked as a placeholder.

#### Scenario: Renders with the layering
- **WHEN** `helmfile -e localAndIonos template` runs
- **THEN** it renders, a value set in `localAndIonos.yaml` wins over the same value in `production.yaml` and `default.yaml`, and a value it doesn't set is production's

#### Scenario: No secret
- **WHEN** the environment is rendered with a secret from an unprefixed shell variable
- **THEN** the secret is only in the Secret, never in a ConfigMap, and the environment's file holds none

#### Scenario: Placeholders
- **WHEN** the environment's file is read
- **THEN** every value not yet given is under the reserved `.invalid` domain or named `replace-me`, with a comment saying what goes there, and the README lists them

#### Scenario: Checked in CI
- **WHEN** CI checks the chart
- **THEN** it renders `localAndIonos` with the other environments and runs the secret check on it

### Requirement: Helm layout and environments
`helm/` SHALL hold `bootstrap.sh`, `helmfile.yaml.gotmpl`, `values.yaml.gotmpl`, `envs/iff-cluster.sh`, `environment/{default,production,localAndIonos}.yaml` and `charts/xana-pdt/`, and Helmfile SHALL define exactly `default`, `production` (default, production) and `localAndIonos` (default, production, localAndIonos), a later file winning.

#### Scenario: Three environments render
- **WHEN** `helmfile -e <environment> template` runs for each of the three
- **THEN** each renders, and no other environment is defined

#### Scenario: Values handed to the chart
- **WHEN** an environment is rendered
- **THEN** the chart receives `imageRegistry`, `imageTag`, `backend.config`, `backend.secret`, `backend.postgresCredential`, `backend.secretLookups` and `ingress.host`, `ingress.className`, `ingress.tlsSecret`

### Requirement: Environment keys
Every setting the backend reads SHALL have a camelCase environment key, documented with the variable it sets, and no key SHALL remain for a setting the backend doesn't read.

#### Scenario: Each key reaches its variable
- **WHEN** each setting key is given a value and the chart is rendered
- **THEN** the backend's configuration holds the variable the design names for it, with that value

#### Scenario: Nothing extra
- **WHEN** the environment files are read
- **THEN** every key is in the design's table, as a setting, a secret, a database or lookup key, or a chart key

### Requirement: Backend secrets
Each backend secret SHALL come from the shell variable of its own name if set, else from its environment key. Database URLs not given SHALL be built in the Pod from database credentials in the release's namespace, and `secretLookups` SHALL read named keys of Secrets in that namespace. Secrets SHALL NOT be in a ConfigMap.

#### Scenario: Shell or file, the shell winning
- **WHEN** a secret is set in the environment file, and then also in the shell
- **THEN** the chart's Secret holds the file's value, and then the shell's, and no ConfigMap holds either

#### Scenario: Database from the operator's Secret
- **WHEN** no database URL is given, on the local test cluster, after `envs/iff-cluster.sh` exported the operator's credentials from `iff`
- **THEN** the backend's URLs are built from the chart's own Secret in `xana-pdt`, and the backend reaches both databases

#### Scenario: A lookup
- **WHEN** `secretLookups` names a variable, Secret and key, on the local test cluster
- **THEN** the backend has that variable with the key's value, and a variable also given as a secret is taken from the secret

#### Scenario: An old variable
- **WHEN** a render runs with an `XANA_*` variable the chart used to read
- **THEN** it stops, naming the variable to use instead, without showing the value

### Requirement: No secret or real host committed
A check SHALL fail when a committed environment file holds a secret value, a key named like a secret outside the design's table, or a host with a dot that isn't under a reserved name.

#### Scenario: A secret in a file
- **WHEN** a secret key in a committed environment file has a value
- **THEN** the check fails, naming the file and key

#### Scenario: A real host
- **WHEN** a committed environment file names a host such as `scorpio.example.org`
- **THEN** the check fails, naming it, while `pgrest` and `xana.replace-me.invalid` pass

### Requirement: Pinned helmfile
`helm/bootstrap.sh` SHALL download the pinned helmfile version to `helm/helmfile`, checking its checksum, and do nothing when that version is already there. `helm/helmfile` SHALL be git-ignored.

#### Scenario: Install and repeat
- **WHEN** `./bootstrap.sh` runs twice
- **THEN** the first run installs the pinned version, and the second downloads nothing

#### Scenario: Wrong checksum
- **WHEN** the downloaded archive doesn't match the pinned checksum
- **THEN** the script stops, saying so, and leaves no binary

### Requirement: Cluster secrets helper
`helm/envs/iff-cluster.sh`, sourced, SHALL export the backend's secrets and the database credentials from the platform namespace's Secrets with `kubectl`, keeping any already set and saying when one differs from the cluster's, writing nothing to disk and printing no secret.

#### Scenario: From the local test cluster
- **WHEN** it is sourced against the local test cluster with its Secrets
- **THEN** the variables, `DATABASE_USERNAME` and `DATABASE_PASSWORD` included, hold the Secrets' values, the output names variables only, and no file was written

#### Scenario: Already set, or missing
- **WHEN** a variable is already set, or a Secret or key doesn't exist
- **THEN** the set value is kept, a missing one is reported by name, and the calling shell goes on

#### Scenario: Shellcheck
- **WHEN** CI checks the script
- **THEN** shellcheck passes

#### Scenario: A kept value that differs
- **WHEN** `DATABASE_PASSWORD` is already set to another value than the operator's Secret holds
- **THEN** it is kept, the output says it differs from that Secret, and neither value is printed

### Requirement: Frontend proxy configuration in a ConfigMap
The chart SHALL hold the frontend's nginx configuration in a ConfigMap with the same content as the image's template, mounted by the frontend.

#### Scenario: Through the ConfigMap
- **WHEN** the smoke test runs on the local test cluster
- **THEN** the UI, the API and the live updates work through the frontend with the ConfigMap's configuration

#### Scenario: Same as the image
- **WHEN** the check compares the ConfigMap's content with the image's template
- **THEN** they are equal

### Requirement: Local test cluster on the default environment
The local test cluster SHALL deploy the `default` environment with a generated values file that isn't committed, XANA in `xana-pdt` and the stand-ins in `iff`, and CI SHALL run the smoke test on it.

#### Scenario: Smoke test
- **WHEN** CI installs on the local test cluster
- **THEN** it uses `default` with the generated file, XANA is in `xana-pdt` and the stand-ins in `iff`, the backend starts and connects to the database, and the smoke test passes

### Requirement: Platform namespace
The key `platformNamespace` (default `iff`) SHALL name the platform's namespace in the default addresses of Scorpio, pgrest, Alerta, Fuseki, the two EMQX addresses and the database host. An address set in an environment file SHALL be used as given.

#### Scenario: Another platform namespace
- **WHEN** the chart is rendered with `platformNamespace: platform`
- **THEN** every one of those default addresses names `platform` instead of `iff`

#### Scenario: An address given
- **WHEN** an environment file sets `ngsiUrl`
- **THEN** the backend gets that value, whatever `platformNamespace` is

### Requirement: Database credentials in the release's namespace
The backend SHALL get its database credentials from `DATABASE_USERNAME` and `DATABASE_PASSWORD`, stored percent-encoded in a Secret the chart creates, else from `databaseCredentialsSecret`, a Secret in the release's namespace. With neither and not both URLs given, the render SHALL stop, naming the options. No rendered reference SHALL name a Secret the chart doesn't render, other than those configured.

#### Scenario: From the shell
- **WHEN** `DATABASE_USERNAME` and `DATABASE_PASSWORD` are set
- **THEN** the chart renders a Secret with them, and `DB_USER` and `DB_PASSWORD` read from it

#### Scenario: A copied Secret
- **WHEN** they aren't set, and `databaseCredentialsSecret` names a Secret
- **THEN** `DB_USER` and `DB_PASSWORD` read from that Secret

#### Scenario: Neither
- **WHEN** neither is given, and the database URLs aren't both given either
- **THEN** the render stops, naming the shell variables, `databaseCredentialsSecret` and the URLs, and so does a render with only one of the two variables

#### Scenario: Special characters
- **WHEN** the password holds `@`, `:`, `/`, `%`, `+` or a space
- **THEN** the stored value is percent-encoded, and decodes to the password

#### Scenario: Only Secrets of its own namespace
- **WHEN** the default environment is rendered with the credentials
- **THEN** every `secretKeyRef`, `envFrom` Secret and Secret volume names a Secret the chart renders

#### Scenario: A password change
- **WHEN** the credentials change and the release is applied again
- **THEN** the chart's Secret and the backend Deployment's checksum change, so the backend restarts
