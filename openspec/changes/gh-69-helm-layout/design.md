# Design

## Context

`deployment/kubernetes` covers the chart, Helmfile, the environments `default`, `production`, `local` and `localAndIonos`, and secrets from `existingSecret`, the database operator's Secret, or `XANA_*` shell variables. This change gives `helm/` the layout of the IndustryFusion platform (DigitalTwin, Dataspace), as #69 sets out. What reaches a cluster stays the same, apart from where its values come from and the frontend's proxy configuration now being a ConfigMap.

It replaces the requirement "Secrets from defined sources", and changes the `localAndIonos` scenario that names `XANA_*` variables. There is no conflict with `architecture.md`, whose deployment section is updated.

## Decisions

### Layout and environments

```
helm/
  bootstrap.sh              # downloads a pinned helmfile to helm/helmfile (git-ignored)
  helmfile.yaml.gotmpl      # environments and the xana-pdt release
  values.yaml.gotmpl        # turns environment values into the chart's values
  envs/
    iff-cluster.sh          # reads the backend's secrets from an IFF cluster and exports them
  environment/
    default.yaml
    production.yaml
    localAndIonos.yaml
  charts/
    xana-pdt/
  test/                     # the local cluster, its stand-ins and the checks, as today
```

There are exactly three environments: `default` (`default.yaml`), `production` (`default.yaml`, `production.yaml`) and `localAndIonos` (`default.yaml`, `production.yaml`, `localAndIonos.yaml`). A later file wins. `local` is removed. The local test cluster deploys `default` with a values file that its set-up generates, under the runner's temporary directory, and gives to `helmfile` with `--state-values-file`. That file holds the stand-in images, the scripted model, `postgresSslMode: disable` and the local Ingress; it is never committed.

### What `values.yaml.gotmpl` gives the chart

| Chart value | From |
|---|---|
| `imageRegistry`, `imageTag`, `imagePullPolicy` | The keys of the same names |
| `backend.config` | One entry per setting key in the table below, left out when the key is empty |
| `backend.secret` | For each secret: the shell variable of its own name if set, else the environment key; left out when both are empty |
| `backend.postgresCredential` | `databaseHost`, `databasePort`, `databaseTimeseriesName`, `databaseMemoryName`, `databaseCredentialsSecret`, `databaseCaSecret` |
| `backend.secretLookups` | `secretLookups` |
| `ingress.enabled`, `ingress.host`, `ingress.className`, `ingress.tlsSecret` | `ingressEnabled`, `ingressHost`, `ingressClassName`, `ingressTlsSecret`; the nginx annotations for 300 s and 64 MB stay, for `className: nginx` |

The chart renders `backend.config` into the backend's ConfigMap and `backend.secret` into a Secret it creates. Neither ever goes into the other.

### Every environment key

Settings, into `backend.config`:

| Key | Backend variable | Default in `default.yaml` |
|---|---|---|
| `llmProvider` | `LLM_PROVIDER` | `ollama` |
| `llmModel` | `LLM_MODEL` | `llama3.1` |
| `llmProviderName` | `LLM_PROVIDER_NAME` | empty |
| `llmNumCtx` | `LLM_NUM_CTX` | `32768` (new key) |
| `llmTimeoutS` | `LLM_TIMEOUT_S` | `120` (new key) |
| `ollamaUrl` | `OLLAMA_URL` | empty |
| `openaiBaseUrl` | `OPENAI_BASE_URL` | empty |
| `langfuseHost` | `LANGFUSE_HOST` | empty |
| `decisionConfidenceThreshold` | `DECISION_CONFIDENCE_THRESHOLD` | `0.9` (new key) |
| `maxConcurrentRounds` | `MAX_CONCURRENT_ROUNDS` | `2` (new key) |
| `autoArchiveAfterS` | `AUTO_ARCHIVE_AFTER_S` | `3600` |
| `keycloakUrl` | `KEYCLOAK_URL` | empty |
| `keycloakRealm` | `KEYCLOAK_REALM` | `iff` |
| `keycloakClientId` | `KEYCLOAK_CLIENT_ID` | `scorpio` |
| `factoryId` | `FACTORY_ID` | empty |
| `keycloakServiceClientId` | `KEYCLOAK_SERVICE_CLIENT_ID` | empty |
| `callbackBaseUrl` | `CALLBACK_BASE_URL` | empty |
| `machineWatchType` | `MACHINE_WATCH_TYPE` | `Machine` |
| `machineWatchAttributes` | `MACHINE_WATCH_ATTRIBUTES` | `status,errorCode,alarmLevel,faultCode` |
| `gatewayUrl` | `GATEWAY_URL` | empty |
| `gatewayKeycloakUrl` | `GATEWAY_KEYCLOAK_URL` | empty |
| `gatewayKeycloakRealm` | `GATEWAY_KEYCLOAK_REALM` | `dataspace` |
| `gatewayClientId` | `GATEWAY_CLIENT_ID` | empty |
| `dataSharingPolicy` | `DATA_SHARING_POLICY` | `minimal` |
| `ifricUrl` | `IFRIC_URL` | empty |
| `inboxPollIntervalS` | `INBOX_POLL_INTERVAL_S` | `15` (new key; the chart set it before) |
| `ngsiUrl` | `NGSI_URL` | `http://scorpio-all-in-one-runner:9090` |
| `ngsiTenant` | `NGSI_TENANT` | empty (new key) |
| `ngsiContextUrl` | `NGSI_CONTEXT_URL` | empty |
| `ngsiAllowedContexts` | `NGSI_ALLOWED_CONTEXTS` | empty (new key) |
| `pgrestUrl` | `PGREST_URL` | `http://pgrest:3000` |
| `alertaUrl` | `ALERTA_URL` | `http://alerta:8080/api` |
| `alertsRefreshIntervalS` | `ALERTS_REFRESH_INTERVAL_S` | `30` |
| `fusekiUrl` | `FUSEKI_URL` | `http://fuseki:3030` |
| `fusekiDataset` | `FUSEKI_DATASET` | `iff` |
| `fusekiGraphBase` | `FUSEKI_GRAPH_BASE` | `http://fuseki.local/iff` |
| `mqttBrokerUrl` | `MQTT_BROKER_URL` | `mqtt://emqx-listeners:1883` |
| `mqttMgmtUrl` | `MQTT_MGMT_URL` | `http://emqx-dashboard:18083` |
| `mqttBrokerNotifyUrl` | `MQTT_BROKER_NOTIFY_URL` | empty |
| `wsAllowedOrigins` | `WS_ALLOWED_ORIGINS` | empty (new key) |
| `timescaleTable` | `TIMESCALE_TABLE` | `attributes` (new key) |
| `timescaleEntityTable` | `TIMESCALE_ENTITY_TABLE` | `entities` (new key) |
| `postgresSslMode` | `POSTGRES_SSLMODE` | `require` |
| `healthTimeoutS` | `HEALTH_TIMEOUT_S` | `3` (new key) |
| `healthCacheS` | `HEALTH_CACHE_S` | `10` (new key) |
| `logLevel` | `LOG_LEVEL` | `INFO` (new key; the chart set it before) |

Secrets, into `backend.secret`. The shell variable wins over the key, and every key is empty in every committed file:

| Shell variable | Key in an environment file |
|---|---|
| `ANTHROPIC_API_KEY` | `anthropicApiKey` (new key) |
| `OPENAI_API_KEY` | `openaiApiKey` (new key) |
| `LANGFUSE_PUBLIC_KEY` | `langfusePublicKey` (new key) |
| `LANGFUSE_SECRET_KEY` | `langfuseSecretKey` (new key) |
| `KEYCLOAK_SERVICE_CLIENT_SECRET` | `keycloakServiceClientSecret` (new key) |
| `EVENT_WEBHOOK_SECRET` | `eventWebhookSecret` (new key) |
| `GATEWAY_CLIENT_SECRET` | `gatewayClientSecret` (new key) |
| `SETTINGS_ENCRYPTION_KEY` | `settingsEncryptionKey` (new key) |
| `ALERTA_API_KEY` | `alertaApiKey` (new key) |
| `TIMESCALE_DB_URL` | `timescaleDbUrl` (new key) |
| `POSTGRES_MEMORY_URL` | `postgresMemoryUrl` (new key) |

Database credentials, into `backend.postgresCredential`:

| Key | Use | Default |
|---|---|---|
| `databaseHost` | Host of both database URLs | `acid-cluster` |
| `databasePort` | Their port | `5432` |
| `databaseTimeseriesName` | Database of `TIMESCALE_DB_URL` | `tsdb` (new key; the chart set it before) |
| `databaseMemoryName` | Database of `POSTGRES_MEMORY_URL` | `memory` (new key; the chart set it before) |
| `databaseCredentialsSecret` | The database operator's Secret, with keys `username` and `password`, read by the Pod at start | `ngb.acid-cluster.credentials` |
| `databaseCaSecret` | A Secret with `ca.crt`, mounted; sets `POSTGRES_SSLROOTCERT` | empty |

A database URL given as a secret (shell or file) is used as it is. Otherwise the chart builds it from `postgresCredential`, as today, and the password never passes through the shell or the rendered manifests.

Other cluster Secrets, into `backend.secretLookups`:

`secretLookups` is a list of `{variable, secret, key}`, for example `{variable: ALERTA_API_KEY, secret: alerta, key: alerta-admin-key}`. Each becomes an environment variable read from that Secret's key when the Pod starts. A variable also given in `backend.secret` is taken from there, and its lookup is left out. Default: an empty list.

Chart and release keys, not backend settings:

| Key | Use |
|---|---|
| `namespace` | The release's namespace, `iff` |
| `imageRegistry`, `imageTag`, `imagePullPolicy` | The images, as `build.sh` pushes them |
| `ingressEnabled`, `ingressHost`, `ingressClassName`, `ingressTlsSecret` | The Ingress; `ingressClassName` was `ingressClass` |

No key, with the reason:
- `LANGFUSE_BASE_URL` is the same setting as `LANGFUSE_HOST`, and two keys could disagree, which stops the backend.
- `BACKEND_HOST` and `BACKEND_PORT` are set by the chart to `0.0.0.0` and `8000`, which the Service and probes need.
- `BACKEND_RELOAD` is for development only.
- `POSTGRES_SSLROOTCERT` is set by the chart from `databaseCaSecret`.

Keys dropped:
- `extraConfig`: every setting now has its own key.
- `existingSecret`: replaced by `secretLookups`.
- `ingressClass`: renamed `ingressClassName`.

### `XANA_*` variables and `existingSecret`: replaced

`XANA_ANTHROPIC_API_KEY`, `XANA_OPENAI_API_KEY`, `XANA_ALERTA_API_KEY`, `XANA_GATEWAY_CLIENT_SECRET`, `XANA_EVENT_WEBHOOK_SECRET`, `XANA_KEYCLOAK_SERVICE_CLIENT_SECRET`, `XANA_SETTINGS_ENCRYPTION_KEY`, `XANA_LANGFUSE_PUBLIC_KEY` and `XANA_LANGFUSE_SECRET_KEY` become the same names without the prefix. `XANA_EXISTING_SECRET`, `XANA_INGRESS_HOST`, `XANA_KEYCLOAK_URL`, `XANA_LANGFUSE_HOST` and `XANA_AUTO_ARCHIVE_AFTER_S` are dropped: non-secret settings come from environment files only, as on the platform.

Reasons:
- The issue asks for unprefixed names.
- The unprefixed names are what `envs/iff-cluster.sh` exports.
- One way per setting is easier to check than two.

A render with any old `XANA_*` variable set stops with a message naming its replacement, so an operator's secret isn't silently left out after the change. The variable's value is never shown. `XANA_BACKEND_URL` inside the frontend container, which the chart sets, is unaffected.

`existingSecret` gave the backend a whole Secret by `envFrom`. It couldn't be mixed with per-variable sources, and the chart couldn't tell which settings it held. `secretLookups` names each variable, and `postgresCredential` covers the database as before.

Alternative: keep both, with the old names as fallbacks. That means two names per secret, and the check for a stray secret would have to know both.

### `bootstrap.sh`

It pins helmfile 1.1.9, the version CI uses, with the SHA-256 of each release archive for Linux and macOS on amd64 and arm64. It downloads the archive for the machine, checks the sum, and puts the binary at `helm/helmfile`. If `helm/helmfile --version` already reports 1.1.9, it does nothing. A wrong sum or an unknown platform stops it, saying why. `helm/helmfile` is git-ignored. The steps then use `./helmfile`.

### `envs/iff-cluster.sh` (proposed Secrets and keys)

It is sourced (`source envs/iff-cluster.sh`), so its exports reach the shell that runs `helmfile`. Without `kubectl`, or without access to the namespace, it says so and exports nothing.

- **Never overwrites:** a variable already set in the shell is kept, so an operator can override any secret by exporting it first.
- **No values shown or stored:** it writes nothing to disk. It prints only which variables it exported and which it didn't find, never a value.
- **Safe to source:** it doesn't change the shell's options, so a missing Secret doesn't end the caller's shell.

| Variable | Secret, key (in namespace `IFF_NAMESPACE`, default `iff`) | Note |
|---|---|---|
| `ALERTA_API_KEY` | `alerta`, `alerta-admin-key` | The platform's Alerta Secret |
| `KEYCLOAK_SERVICE_CLIENT_SECRET` | `keycloak-client-secret-xana`, `CLIENT_SECRET` | The platform's naming for Keycloak client Secrets; the client for XANA has to be created on the platform |
| `GATEWAY_CLIENT_SECRET`, `SETTINGS_ENCRYPTION_KEY`, `EVENT_WEBHOOK_SECRET`, `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `LANGFUSE_PUBLIC_KEY`, `LANGFUSE_SECRET_KEY` | `xana-pdt-credentials`, a key per variable name | XANA's own Secret, created once by the operator; any key it lacks is skipped |

It doesn't export the database URLs: `postgresCredential` reads the operator's Secret in the Pod, so the password never passes through the shell.

Overrides:
- `IFF_NAMESPACE` changes the namespace.
- `IFF_ALERTA_SECRET`, `IFF_KEYCLOAK_CLIENT_SECRET` and `IFF_XANA_SECRET` change the Secrets' names.
- Exporting a variable before sourcing the script keeps its value.

**For the maintainer:** the Secret names `keycloak-client-secret-xana` and `xana-pdt-credentials` are proposals; confirm or rename them.

Alternative: put the secrets into a file for `helmfile`. The issue asks for nothing on disk.

### `frontend-configmap.yaml`

It holds `default.conf.template` with the same content as `frontend/nginx/default.conf.template`. It is mounted over the image's template path, so nginx renders it with `XANA_BACKEND_URL` at start as today.

A check compares the two files, so the image and the chart don't drift. The ConfigMap's checksum is an annotation on the frontend Deployment, so a change restarts the frontend.

Alternative: generate the ConfigMap from the image's file with `.Files.Get`. A chart can only read files inside itself, so the template would have to move into the chart, and the image build would then read from `helm/`.

### No secret or real host in a committed file

The check covers `default.yaml`, `production.yaml` and `localAndIonos.yaml`:
- Every secret key in the table above is empty.
- No key outside that table is named like a secret.
- Every host with a dot is under a reserved name: `.invalid`, `.example`, `.test`, `.local` or `.localhost`.
- A single-label in-cluster Service name, such as `pgrest`, is allowed.
- `imageRegistry` may name the project's public registry, `ghcr.io/industryfusion`.

The existing `localAndIonos` placeholder and inherited-address checks stay.

### `build.sh` settings in the root `.env`

As the maintainer decided while reviewing this change: `build.sh` reads `REGISTRY` and `IMAGE_TAG` from a git-ignored `.env` at the repository root instead of `build.conf`. `build.conf` and `build.conf.example` are removed. The keys go into a new, committed `.env.example` at the root (there is none yet), with the header. Everything else stays:
- shell variables still win;
- `.env` is read as `KEY=VALUE` data for those two keys, never sourced or run;
- a line that isn't one of them stops the script, naming it;
- the defaults stay `k3d-iff.localhost:12345` and `latest`.

`.gitignore` covers `.env`. Only the root `.env` is read, so the backend's own `backend/.env` is unaffected.

### Steps for an operator

1. Set the values in an environment file.
2. `source envs/iff-cluster.sh`, or export the secrets.
3. `./bootstrap.sh`.
4. `./helmfile -e <environment> apply`.

## Risks

- Operators using `XANA_*` names have to rename them; a render that still sees one stops and names the replacement.
- `secretLookups` and `postgresCredential` reference Secrets that must exist when the Pod starts. A missing one keeps the Pod from starting, with the Secret's name in its events.
