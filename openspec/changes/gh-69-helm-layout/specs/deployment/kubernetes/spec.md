# Spec Delta

## REMOVED Requirements

### Requirement: Secrets from defined sources
**Reason**: Replaced by "Backend secrets", which takes each secret from an unprefixed shell variable or the environment file, and cluster Secrets through `postgresCredential` and `secretLookups`, as #69 sets out.
**Migration**: Rename `XANA_<NAME>` shell variables to `<NAME>`; replace `existingSecret` with `secretLookups` entries. A render with an old `XANA_*` variable set stops and names its replacement.

## MODIFIED Requirements

### Requirement: Build and push script
`build.sh` SHALL build the backend and frontend images and push them as `<REGISTRY>/xana-ai-pdt-<name>:<IMAGE_TAG>`, with `REGISTRY` defaulting to `k3d-iff.localhost:12345` and `IMAGE_TAG` to `latest`, taking shell variables before an optional, git-ignored `.env` at the repository root, read as data.

#### Scenario: Defaults
- **WHEN** `./build.sh` runs with no settings
- **THEN** both images are built and pushed to `k3d-iff.localhost:12345` with tag `latest`, and the registry, tag and image names are printed first

#### Scenario: Registry and tag from the shell
- **WHEN** `REGISTRY=<host>/<path> IMAGE_TAG=1.2.3 ./build.sh` runs against a registry
- **THEN** `<host>/<path>/xana-ai-pdt-backend:1.2.3` and `<host>/<path>/xana-ai-pdt-frontend:1.2.3` are in that registry

#### Scenario: Settings file and shell
- **WHEN** `.env` sets the registry and tag, and the shell sets the tag too
- **THEN** the registry from the file and the tag from the shell are used

#### Scenario: A settings file it can't read
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

## ADDED Requirements

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
Each backend secret SHALL come from the shell variable of its own name if set, else from its environment key. Database URLs not given SHALL be built from `postgresCredential`, and `secretLookups` SHALL read named keys of cluster Secrets. Secrets SHALL NOT be in a ConfigMap.

#### Scenario: Shell or file, the shell winning
- **WHEN** a secret is set in the environment file, and then also in the shell
- **THEN** the chart's Secret holds the file's value, and then the shell's, and no ConfigMap holds either

#### Scenario: Database from the operator's Secret
- **WHEN** no database URL is given, on the local test cluster
- **THEN** the backend's URLs are built from `databaseCredentialsSecret`, and the backend reaches both databases

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
`helm/envs/iff-cluster.sh`, sourced, SHALL export the backend's secrets from the cluster's Secrets with `kubectl` under their variable names, keeping any already set, writing nothing to disk and printing no secret.

#### Scenario: From the local test cluster
- **WHEN** it is sourced against the local test cluster with its Secrets
- **THEN** the variables hold the Secrets' values, the output names variables only, and no file was written

#### Scenario: Already set, or missing
- **WHEN** a variable is already set, or a Secret or key doesn't exist
- **THEN** the set value is kept, a missing one is reported by name, and the calling shell goes on

#### Scenario: Shellcheck
- **WHEN** CI checks the script
- **THEN** shellcheck passes

### Requirement: Frontend proxy configuration in a ConfigMap
The chart SHALL hold the frontend's nginx configuration in a ConfigMap with the same content as the image's template, mounted by the frontend.

#### Scenario: Through the ConfigMap
- **WHEN** the smoke test runs on the local test cluster
- **THEN** the UI, the API and the live updates work through the frontend with the ConfigMap's configuration

#### Scenario: Same as the image
- **WHEN** the check compares the ConfigMap's content with the image's template
- **THEN** they are equal

### Requirement: Local test cluster on the default environment
The local test cluster SHALL deploy the `default` environment with a generated values file that isn't committed, and CI SHALL run the smoke test on it.

#### Scenario: Smoke test
- **WHEN** CI installs on the local test cluster
- **THEN** it uses `default` with the generated file, and the smoke test passes
