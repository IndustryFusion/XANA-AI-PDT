## MODIFIED Requirements

### Requirement: Platform namespace
The key `platformNamespace` (default `iff`) SHALL name the namespace of the platform's Secrets: `alerta` and the Keycloak client Secret, each `secretLookups` entry naming `$platformNamespace` or no namespace, and by default the database operator's Secret. XANA's own Secrets SHALL be read in the release's `namespace`. `platformNamespace` SHALL NOT change any address.

#### Scenario: Another platform namespace
- **WHEN** the chart is rendered with `platformNamespace: platform`
- **THEN** the platform's lookups read from `platform`, XANA's own from the release's namespace, and every address is the one written in `default.yaml`

#### Scenario: An address given
- **WHEN** an environment file sets `ngsiUrl`
- **THEN** the backend gets that value, whatever `platformNamespace` is

### Requirement: Platform Secrets read when deploying
A secret or credential not given in the shell or the file SHALL be read with Helm `lookup` when deploying, with the deploying user's own permissions, in the namespace its entry names (`$namespace`, `$platformNamespace` or a name; the database Secret's in `databaseCredentialsNamespace`), and copied into the chart's Secrets. Without a cluster, the lookups SHALL be skipped and the rendered Secrets SHALL say so.

#### Scenario: Without a cluster
- **WHEN** `helmfile -e default template` runs with `KUBECONFIG=/dev/null` and no secrets in the shell
- **THEN** it renders, the database and backend Secrets carry the note that the platform's Secrets weren't read, and no lookup-dependent check stops it

#### Scenario: Looked-up values
- **WHEN** the lookups run with the defaults
- **THEN** `xana-pdt-credentials` is read in `xana-pdt`, and `alerta` and the database Secret in `iff`; a value given in the shell or the file wins; and changing `namespace`, `platformNamespace` or `databaseCredentialsNamespace` moves the matching lookups

#### Scenario: An unknown reference
- **WHEN** an entry's `namespace` is a `$` name other than `$namespace` and `$platformNamespace`
- **THEN** the render stops, naming it

### Requirement: Cluster secrets helper
`helm/envs/iff-cluster.sh`, sourced, SHALL export the backend's secrets and the database credentials with `kubectl`, reading `xana-pdt-credentials` in `XANA_NAMESPACE` (default `xana-pdt`) and the platform's Secrets in `IFF_NAMESPACE` (default `iff`), keeping any already set and saying when one differs, writing nothing to disk and printing no secret.

#### Scenario: From the local test cluster
- **WHEN** it is sourced against a cluster with those Secrets in those namespaces
- **THEN** the variables, `DATABASE_USERNAME` and `DATABASE_PASSWORD` included, hold the Secrets' values, the output names variables and both namespaces only, and no file was written

#### Scenario: Already set, or missing
- **WHEN** a variable is already set, or a Secret, key or one of the two namespaces doesn't exist
- **THEN** the set value is kept, a missing one is reported by name, and the calling shell goes on

#### Scenario: Shellcheck
- **WHEN** the script is checked
- **THEN** shellcheck passes

#### Scenario: A kept value that differs
- **WHEN** `DATABASE_PASSWORD` is already set to another value than the operator's Secret holds
- **THEN** it is kept, the output says it differs from that Secret, and neither value is printed
