## REMOVED Requirements

### Requirement: The localAndIonos environment
**Reason**: Its file covered different keys from `default.yaml`, and it wasn't clear what it was for. `default.yaml` now holds every key, with the ones a cluster needs in its Section 2.
**Migration**: Put its values into Section 2 of `environment/default.yaml`, and deploy with `-e production` for the production overrides. `-e localAndIonos` stops with a message saying so.

## MODIFIED Requirements

### Requirement: Installable chart
The project SHALL provide a Helm chart and Helmfile that install the frontend and backend with their Services, configuration, Ingress, probes and resources, in namespace `xana-pdt` by default, with the platform's in-cluster addresses written out in full in `default.yaml`.

#### Scenario: Fresh install
- **WHEN** an operator follows the documented steps on a cluster running the platform
- **THEN** every Pod reaches ready, and the health report shows the connections

#### Scenario: Default addresses
- **WHEN** the chart is rendered with default values
- **THEN** it is in namespace `xana-pdt`, and uses `scorpio-all-in-one-runner.iff.svc.cluster.local:9090`, `acid-cluster.iff.svc.cluster.local:5432/tsdb` and `/memory`, and `callbackBaseUrl` `http://xana-pdt-backend.xana-pdt.svc.cluster.local:8000`

#### Scenario: Runs through the Ingress
- **WHEN** a client starts a run through the Ingress and opens its live stream
- **THEN** the run's steps arrive on the stream

#### Scenario: Restart keeps data
- **WHEN** the backend Pod restarts
- **THEN** runs and incidents are still there

#### Scenario: One backend replica
- **WHEN** the chart is rendered
- **THEN** it runs one backend replica, because runs are held in the process

### Requirement: Helm layout and environments
`helm/` SHALL hold `bootstrap.sh`, `helmfile.yaml.gotmpl`, `values.yaml.gotmpl`, `envs/iff-cluster.sh`, `environment/{default,production}.yaml` and `charts/xana-pdt/`. Helmfile SHALL define exactly `default` and `production` (default, then production), and `-e localAndIonos` SHALL stop with a message naming them. `production.yaml` SHALL hold only the image tag, pull policy and TLS Secret.

#### Scenario: Three environments render
- **WHEN** `helmfile -e <environment> template` runs for `default` and `production`, and for `localAndIonos`
- **THEN** the first two render, no other environment is defined, and `localAndIonos` stops, naming `default` and `production`

#### Scenario: Values handed to the chart
- **WHEN** an environment is rendered
- **THEN** the chart receives `imageRegistry`, `imageTag`, `backend.config`, `backend.secret`, `backend.postgresCredential`, `backend.secretLookups` and `ingress.host`, `ingress.className`, `ingress.tlsSecret`

### Requirement: Environment keys
Every setting the backend reads SHALL have a camelCase environment key in `default.yaml`, documented with the variable it sets, and no key SHALL remain for a setting the backend doesn't read.

#### Scenario: Each key reaches its variable
- **WHEN** each setting key is given a value and the chart is rendered
- **THEN** the backend's configuration holds the variable the design names for it, with that value

#### Scenario: Nothing extra
- **WHEN** the environment files are read
- **THEN** every key is in the design's table, as a setting, a secret, a database or lookup key, or a chart key

### Requirement: Backend secrets
Each backend secret SHALL come from the shell variable of its own name, else its environment key, else a `secretLookups` entry read when deploying. Database URLs not given SHALL be built in the Pod from the credentials in the chart's own Secret. Secrets SHALL NOT be in a ConfigMap. `LANGFUSE_HOST` and `LANGFUSE_BASE_URL` SHALL be accepted from the shell for `langfuseHost`.

#### Scenario: Shell or file, the shell winning
- **WHEN** a secret is set in the environment file, and then also in the shell, by sourcing an env file with `set -a`
- **THEN** the chart's Secret holds the file's value, and then the shell's, and no ConfigMap holds either

#### Scenario: Database from the operator's Secret
- **WHEN** no database URL or credential is given, on the local test cluster in CI
- **THEN** the credentials are read from the operator's Secret in `iff` when deploying, the URLs are built from the chart's own Secret in `xana-pdt`, and the backend reaches both databases

#### Scenario: A lookup
- **WHEN** a `secretLookups` entry names a variable, Secret, key and namespace, on the local test cluster in CI
- **THEN** the backend has that variable with the key's value through the chart's Secret, and a variable also given in the shell or the file is taken from there

#### Scenario: An old variable
- **WHEN** a render runs with an `XANA_*` variable the chart used to read
- **THEN** it stops, naming the variable to use instead, without showing the value

### Requirement: No secret or real host committed
A check SHALL fail when a committed environment file holds a secret value, a key named like a secret outside the design's table, or a host with a dot that isn't under a reserved name or `.svc.cluster.local`.

#### Scenario: A secret in a file
- **WHEN** a secret key in a committed environment file has a value
- **THEN** the check fails, naming the file and key

#### Scenario: A real host
- **WHEN** a committed environment file names a host such as `scorpio.example.org`
- **THEN** the check fails, naming it, while `pgrest`, `pgrest.iff.svc.cluster.local` and `xana.replace-me.invalid` pass

### Requirement: Platform namespace
The key `platformNamespace` (default `iff`) SHALL name the namespace the chart reads platform Secrets from, for the database credentials and each `secretLookups` entry without a `namespace`. It SHALL NOT change any address: each address SHALL be used as written in the environment files.

#### Scenario: Another platform namespace
- **WHEN** the chart is rendered with `platformNamespace: platform`
- **THEN** the lookups read from `platform`, and every address is the one written in `default.yaml`

#### Scenario: An address given
- **WHEN** an environment file sets `ngsiUrl`
- **THEN** the backend gets that value, whatever `platformNamespace` is

### Requirement: Database credentials in the release's namespace
The backend SHALL get its database credentials from `DATABASE_USERNAME` and `DATABASE_PASSWORD`, else the file's keys, else `databaseCredentialsSecret` read in `platformNamespace` when deploying, all stored percent-encoded in a Secret the chart creates. With none found and not both URLs given, the render SHALL stop, naming what it read and the options. No rendered reference SHALL name a Secret the chart doesn't render, other than those configured.

#### Scenario: From the shell
- **WHEN** `DATABASE_USERNAME` and `DATABASE_PASSWORD` are set
- **THEN** the chart renders a Secret with them, and `DB_USER` and `DB_PASSWORD` read from it

#### Scenario: A copied Secret
- **WHEN** they aren't set, and the operator's Secret named by `databaseCredentialsSecret` is found in `platformNamespace` when deploying
- **THEN** its values are stored in the chart's Secret, percent-encoded, and `DB_USER` and `DB_PASSWORD` read from it, so no copy in `xana-pdt` is needed

#### Scenario: Neither
- **WHEN** no credentials are given or found, with a cluster to read from, and the database URLs aren't both given either
- **THEN** the render stops, naming the Secret and namespace it read, the shell variables and the URLs, and so does a render with only one of the two variables

#### Scenario: Special characters
- **WHEN** the password holds `@`, `:`, `/`, `%`, `+` or a space
- **THEN** the stored value is percent-encoded, and decodes to the password

#### Scenario: Only Secrets of its own namespace
- **WHEN** each environment is rendered with the credentials
- **THEN** every `secretKeyRef`, `envFrom` Secret, Secret volume, pull Secret and Ingress TLS Secret names a Secret the chart renders, or one configured to be in `xana-pdt`

#### Scenario: A password change
- **WHEN** the credentials change and the release is applied again
- **THEN** the chart's Secret and the backend Deployment's checksum change, so the backend restarts

### Requirement: Local test cluster on the default environment
The local test cluster in CI SHALL deploy the `default` environment with a generated values file that isn't committed, XANA in `xana-pdt` and the stand-ins in `iff`, without sourcing `envs/iff-cluster.sh`, and SHALL run the smoke test on it.

#### Scenario: Smoke test
- **WHEN** CI installs on the local test cluster
- **THEN** it uses `default` with the generated file, XANA is in `xana-pdt` and the stand-ins in `iff`, the credentials and lookups are read when deploying, the backend connects to the database, and the smoke test passes

## ADDED Requirements

### Requirement: Sections of the default environment
`default.yaml` SHALL hold every key in three sections, in order: "Filled in for you", with the platform's addresses written out as `<service>.iff.svc.cluster.local`; "Fill in for your cluster", each key with what it is, an example, and what empty does; and "Secrets", each empty, with its shell variable, purpose, when required, and how to get it.

#### Scenario: The sections
- **WHEN** the check reads `default.yaml`
- **THEN** the three section headers are there in order, and every key is in the section the design lists it in

#### Scenario: Each key explained
- **WHEN** the check reads Sections 2 and 3
- **THEN** every Section 2 key has its `Example:` and `If empty:` lines, every secret its `For:`, `Required:` and `Get:` lines, and every Section 1 platform address ends in `.svc.cluster.local`

### Requirement: Platform Secrets read when deploying
A secret or credential not given in the shell or the file SHALL be read with Helm `lookup` when deploying, with the deploying user's own permissions, and copied into the chart's Secrets. Without a cluster, the lookups SHALL be skipped, the rendered Secrets SHALL say so, and nothing SHALL stop that `apply` would pass.

#### Scenario: Without a cluster
- **WHEN** `helmfile -e default template` runs with `KUBECONFIG=/dev/null` and no secrets in the shell
- **THEN** it renders, the database and backend Secrets carry the note that the platform's Secrets weren't read, and no lookup-dependent check stops it

#### Scenario: Looked-up values
- **WHEN** the render checks give the lookup helper test Secrets in place of a cluster's
- **THEN** a missing credential or paired secret is taken from them, and one given in the shell or the file wins over them

### Requirement: Checked when deploying
The render SHALL stop, with the backend's own message from `backend/app/config.py` and a hint where useful, for each pair the backend enforces, such as `SETTINGS_ENCRYPTION_KEY` with `gatewayUrl` (with the command that makes a key), `EVENT_WEBHOOK_SECRET` with `callbackBaseUrl`, and the service client's ID and secret together.

#### Scenario: A missing pair
- **WHEN** `gatewayUrl` is set without `SETTINGS_ENCRYPTION_KEY`, and likewise for each pair in the design
- **THEN** the render stops with the backend's message, and for the key, the command that generates one

#### Scenario: In step with the backend
- **WHEN** the check compares the chart's messages with `backend/app/config.py`
- **THEN** each is there word for word
