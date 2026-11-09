## MODIFIED Requirements

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

### Requirement: Local test cluster on the default environment
The local test cluster SHALL deploy the `default` environment with a generated values file that isn't committed, XANA in `xana-pdt` and the stand-ins in `iff`, and CI SHALL run the smoke test on it.

#### Scenario: Smoke test
- **WHEN** CI installs on the local test cluster
- **THEN** it uses `default` with the generated file, XANA is in `xana-pdt` and the stand-ins in `iff`, the backend starts and connects to the database, and the smoke test passes

## ADDED Requirements

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
