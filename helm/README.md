# Deploying XANA AI PDT on Kubernetes

Installs the operator UI and backend next to the [digital twin platform](https://github.com/IndustryFusion/DigitalTwin), with Helm 3 and [Helmfile](https://helmfile.readthedocs.io/) 1.1.9, which `bootstrap.sh` downloads.

## What it needs

- A cluster running the platform, and `kubectl` pointing at it.
- Images: `xana-ai-pdt-backend` and `xana-ai-pdt-frontend`. A `v*` tag publishes them to `ghcr.io/industryfusion`. To build your own, see [Images](#images).
- A language model the cluster can reach. See [Language model](#language-model).

The platform's PostgreSQL chart already declares the `memory` and `tsdb` databases, and its operator generates the `ngb.acid-cluster.credentials` Secret in the platform's namespace.


## Layout

```
helm/
├── bootstrap.sh            # downloads the pinned Helmfile into helm/helmfile (git-ignored)
├── helmfile.yaml.gotmpl    # the release and the environments default and production
├── values.yaml.gotmpl      # turns the environment keys and shell variables into the chart's values
├── environment/
│   ├── default.yaml        # every key, in three sections (below)
│   └── production.yaml     # over default.yaml: the image tag, pull policy and TLS Secret
├── envs/
│   └── iff-cluster.sh      # optional: exports the backend's secrets from the platform's Secrets
├── charts/xana-pdt/        # the chart
└── test/                   # checks, stand-ins and the local test cluster
```

This is the layout of the IndustryFusion platform's charts (DigitalTwin, Dataspace).

## `default.yaml` at a glance

| Section | What it holds | Who sets it |
|---|---|---|
| 1. Filled in for you | The platform's in-cluster addresses, written out as `<service>.iff.svc.cluster.local`; `callbackBaseUrl`; the images, databases, realms, client ID and operational defaults | Nobody, unless your platform differs |
| 2. Fill in for your cluster | The Ingress, Keycloak's external address, the language model, the dataspace, IFRIC, Fuseki's graph base, Langfuse. Each key has an `Example:` and an `If empty:` line | You |
| 3. Secrets | Every secret, empty, with its shell variable, what it is for, when it is required and how to get it; then the platform Secrets read when deploying | You, in your own env file |

## Install

From `helm/`, once: `./bootstrap.sh`. It downloads Helmfile 1.1.9 for your system into `helm/helmfile`, checks its SHA-256 against the checksum in the script, and does nothing if that version is already there. `HELMFILE_DOWNLOAD_URL` points it at a mirror.

Then:

1. If you serve XANA over TLS, copy the TLS Secret into `xana-pdt` (see [Namespaces](#namespaces)).
2. Fill in Section 2 of `environment/default.yaml`, in your own copy.
3. Put the secrets you give yourself in your own env file, outside the repository (see [Secrets](#secrets)), and load it:

   ```bash
   set -a; source ~/xana/my-secrets.env; set +a
   ```

4. Deploy:

   ```bash
   ./helmfile -e default apply --suppress-secrets     # or -e production
   ```

A secret you don't give is read from the platform's Secrets during `apply`, with your own access (see [Read when deploying](#read-when-deploying)). Anything a setting needs and nobody gives stops `apply` with the backend's own message.

An example env file, with every name the chart reads; leave out or empty what you don't use:

```bash
# my-secrets.env: keep it outside the repository, readable only by you.
ANTHROPIC_API_KEY=
OPENAI_API_KEY=
ALERTA_API_KEY=
EVENT_WEBHOOK_SECRET=                 # openssl rand -hex 32; needed while callbackBaseUrl is set
KEYCLOAK_SERVICE_CLIENT_SECRET=
SETTINGS_ENCRYPTION_KEY=              # needed with gatewayUrl; see Section 3 for the command
GATEWAY_CLIENT_SECRET=
LANGFUSE_PUBLIC_KEY=
LANGFUSE_SECRET_KEY=
LANGFUSE_HOST=                        # or LANGFUSE_BASE_URL, the same address under its other name
DATABASE_USERNAME=                    # empty: read from the database operator's Secret
DATABASE_PASSWORD=
TIMESCALE_DB_URL=                     # empty: built from the credentials
POSTGRES_MEMORY_URL=
```

An empty variable is ignored, and the file's key or the lookup applies.

Check it:

```bash
kubectl -n xana-pdt get pods
kubectl -n xana-pdt exec deploy/xana-pdt-backend -- \
  python -c "import httpx; print(httpx.get('http://localhost:8000/api/diagnostics?fresh=true').text)"
```

To remove the release: `./helmfile -e default destroy`. Data in the database is kept.

## Namespaces

XANA goes in its own namespace, `xana-pdt` (`namespace`), and reaches the platform in `iff`:

- The platform's addresses in Section 1 name `iff`. On a platform in another namespace, change them there. `platformNamespace` (default `iff`) names where the chart reads the platform's Secrets; it changes no address.
- A Pod reads Secrets only in its own namespace, and an Ingress finds its TLS Secret only there. The chart copies what it reads from the platform into its own Secrets in `xana-pdt`. Every other Secret it names has to be in `xana-pdt`: `databaseCaSecret`, `ingressTlsSecret` (`xana-tls` in `production`), and the chart's `imagePullSecrets`.
- To install next to the platform instead, set `namespace: iff`.

**Moving an earlier install from `iff`.** `apply` doesn't move a release: it would install a second one in `xana-pdt` next to the old one. Two releases would have Ingresses for the same host and path, so the new one is refused by ingress-nginx's admission check, or traffic keeps going to the old one. Two backends would also share the database, the automatic archive, the dataspace inbox and the Scorpio subscriptions, and handle every event twice. So, in this order:

1. Copy into `xana-pdt` the Secrets XANA names there: the TLS Secret first of all, or the Ingress serves the controller's default certificate, and any `imagePullSecrets` and `databaseCaSecret` Secrets.
2. Start from the new `default.yaml`, and carry your own values across into Section 2.
3. Remove the old release: `helm -n iff uninstall xana-pdt`. The runs and incidents are in the platform's database and are kept. Its Scorpio subscription stays until the new backend replaces it.
4. Then `./helmfile -e <environment> apply`, installing in `xana-pdt`.

**Network policies.** A NetworkPolicy in `iff` that admits only its own namespace has to admit `xana-pdt` too: from XANA to the platform's services; for machine events, from Scorpio to XANA's backend; and for alerts, from Alerta's plugin to the backend's `/events/alert`. One in `xana-pdt` has to admit both ways likewise.

To copy a Secret from `iff` into `xana-pdt`, for example the TLS Secret:

```bash
kubectl -n iff get secret <name> -o json \
  | jq 'del(.metadata.namespace, .metadata.uid, .metadata.resourceVersion, .metadata.creationTimestamp, .metadata.ownerReferences, .metadata.managedFields)' \
  | kubectl -n xana-pdt apply -f -
```

A copy doesn't follow later changes in `iff`: copy it again, then `kubectl -n xana-pdt rollout restart deploy/xana-pdt-backend`.

## Environments

| Environment | Files, a later one winning | For |
|---|---|---|
| `default` | `default.yaml` | Any cluster running the platform, with the published images |
| `production` | `default.yaml`, `production.yaml` | A pinned image tag and the TLS Secret `xana-tls` |

`localAndIonos` is gone: `-e localAndIonos` stops with a message saying to use `default` or `production`, and to put your cluster's values in Section 2. In CI, `test/check_environments.py` checks the layering, that `production.yaml` holds only its three overrides, and that message.

## Configuration

Every key is in `environment/default.yaml`, in its section. Each setting becomes the backend variable named below, in the backend's ConfigMap; an empty value leaves the variable out, so the backend's own default applies. See [`backend/.env.example`](../backend/.env.example) for what each variable does.

### Release and images

| Key | Default | What it is |
|---|---|---|
| `namespace` | `xana-pdt` | The release's namespace |
| `platformNamespace` | `iff` | Where the platform's Secrets are read when deploying; it changes no address |
| `imageRegistry` | `ghcr.io/industryfusion` | Registry and path of `xana-ai-pdt-backend` and `xana-ai-pdt-frontend` |
| `imageTag` | empty: `v` and the chart's app version | The images' tag |
| `imagePullPolicy` | `IfNotPresent` | |

### Backend settings

| Key | Variable | Default |
|---|---|---|
| `llmProvider` | `LLM_PROVIDER` | `ollama` |
| `llmModel` | `LLM_MODEL` | `llama3.1` |
| `llmProviderName` | `LLM_PROVIDER_NAME` | |
| `llmNumCtx` | `LLM_NUM_CTX` | `32768` |
| `llmTimeoutS` | `LLM_TIMEOUT_S` | `120` |
| `ollamaUrl` | `OLLAMA_URL` | |
| `openaiBaseUrl` | `OPENAI_BASE_URL` | |
| `decisionConfidenceThreshold` | `DECISION_CONFIDENCE_THRESHOLD` | `0.9` |
| `maxConcurrentRounds` | `MAX_CONCURRENT_ROUNDS` | `2` |
| `autoArchiveAfterS` | `AUTO_ARCHIVE_AFTER_S` | `3600` |
| `keycloakUrl` | `KEYCLOAK_URL` | |
| `keycloakRealm` | `KEYCLOAK_REALM` | `iff` |
| `keycloakClientId` | `KEYCLOAK_CLIENT_ID` | `scorpio` |
| `factoryId` | `FACTORY_ID` | |
| `keycloakServiceClientId` | `KEYCLOAK_SERVICE_CLIENT_ID` | |
| `ngsiUrl` | `NGSI_URL` | `http://scorpio-all-in-one-runner.iff.svc.cluster.local:9090` |
| `ngsiTenant` | `NGSI_TENANT` | |
| `ngsiContextUrl` | `NGSI_CONTEXT_URL` | |
| `ngsiAllowedContexts` | `NGSI_ALLOWED_CONTEXTS` | |
| `pgrestUrl` | `PGREST_URL` | `http://pgrest.iff.svc.cluster.local:3000` |
| `callbackBaseUrl` | `CALLBACK_BASE_URL` | `http://xana-pdt-backend.xana-pdt.svc.cluster.local:8000` |
| `machineWatchType` | `MACHINE_WATCH_TYPE` | `Machine` |
| `machineWatchAttributes` | `MACHINE_WATCH_ATTRIBUTES` | `status,errorCode,alarmLevel,faultCode` |
| `alertaUrl` | `ALERTA_URL` | `http://alerta.iff.svc.cluster.local:8080/api` |
| `alertsRefreshIntervalS` | `ALERTS_REFRESH_INTERVAL_S` | `30` |
| `gatewayUrl` | `GATEWAY_URL` | |
| `gatewayKeycloakUrl` | `GATEWAY_KEYCLOAK_URL` | |
| `gatewayKeycloakRealm` | `GATEWAY_KEYCLOAK_REALM` | `dataspace` |
| `gatewayClientId` | `GATEWAY_CLIENT_ID` | |
| `dataSharingPolicy` | `DATA_SHARING_POLICY` | `minimal` |
| `inboxPollIntervalS` | `INBOX_POLL_INTERVAL_S` | `15` |
| `ifricUrl` | `IFRIC_URL` | |
| `fusekiUrl` | `FUSEKI_URL` | `http://fuseki.iff.svc.cluster.local:3030` |
| `fusekiDataset` | `FUSEKI_DATASET` | `iff` |
| `fusekiGraphBase` | `FUSEKI_GRAPH_BASE` | `http://fuseki.local/iff` |
| `mqttBrokerUrl` | `MQTT_BROKER_URL` | `mqtt://emqx-listeners.iff.svc.cluster.local:1883` |
| `mqttMgmtUrl` | `MQTT_MGMT_URL` | `http://emqx-dashboard.iff.svc.cluster.local:18083` |
| `mqttBrokerNotifyUrl` | `MQTT_BROKER_NOTIFY_URL` | |
| `wsAllowedOrigins` | `WS_ALLOWED_ORIGINS` | |
| `langfuseHost` | `LANGFUSE_HOST` (`LANGFUSE_HOST` or `LANGFUSE_BASE_URL` in the shell win) | |
| `postgresSslMode` | `POSTGRES_SSLMODE` | `require` |
| `timescaleTable` | `TIMESCALE_TABLE` | `attributes` |
| `timescaleEntityTable` | `TIMESCALE_ENTITY_TABLE` | `entities` |
| `healthTimeoutS` | `HEALTH_TIMEOUT_S` | `3` |
| `healthCacheS` | `HEALTH_CACHE_S` | `10` |
| `logLevel` | `LOG_LEVEL` | `INFO` |

The chart's own [`values.yaml`](charts/xana-pdt/values.yaml), for an install with plain `helm`, has the same full addresses.

### Database

| Key | Default | What it is |
|---|---|---|
| `databaseHost`, `databasePort` | `acid-cluster.iff.svc.cluster.local`, `5432` | The PostgreSQL server |
| `databaseTimeseriesName`, `databaseMemoryName` | `tsdb`, `memory` | The two databases |
| `databaseCredentialsSecret` | `ngb.acid-cluster.credentials` | The database operator's Secret, with keys `username` and `password`, read when deploying |
| `databaseCredentialsNamespace` | `$platformNamespace` | Where that Secret is: `$platformNamespace`, `$namespace` for a copy in `xana-pdt`, or a namespace's name |
| `databaseCaSecret` | | A Secret in `xana-pdt` holding the CA certificate as `ca.crt` |

Unless `TIMESCALE_DB_URL` and `POSTGRES_MEMORY_URL` are given, as secrets or by `secretLookups`, the Pod builds them when it starts from the database credentials, host, port and database names; only a missing one is built.

#### Database credentials

The credentials come from the first of these, and are kept in the chart's own Secret, `xana-pdt-database`, percent-encoded, so a password with `@`, `:`, `/`, `%`, `+`, spaces or any other character reaches the database unchanged:

1. `DATABASE_USERNAME` and `DATABASE_PASSWORD` in the shell;
2. the keys `databaseUsername` and `databasePassword`, empty in committed files;
3. `databaseCredentialsSecret`, read in `databaseCredentialsNamespace` when deploying.

With none found, `apply` stops, naming the Secret and namespace it read. It also stops when only one of the two variables is set.

**After a password change on the platform**, XANA's copy is stale: the System screen and `/api/diagnostics` show the databases failing. `apply` again: the operator's Secret is read again, the chart's Secret changes, and the backend restarts with it. If you give the credentials in the shell, give the new ones.

Connections use TLS (`postgresSslMode: require`), which encrypts but doesn't check the server. To check it, set `postgresSslMode` to `verify-ca` or `verify-full`, and `databaseCaSecret`. The chart mounts it and sets `POSTGRES_SSLROOTCERT`.

### Ingress

| Key | Default | What it is |
|---|---|---|
| `ingressEnabled` | `true` | |
| `ingressClassName` | `traefik` | `traefik`, the platform's, or `nginx` |
| `ingressHost` | `xana.local` | XANA's host name |
| `ingressTlsSecret` | empty; `xana-tls` in `production` | The TLS Secret for that host |

The Ingress sends everything to the frontend, which forwards `/api`, `/ws` and `/api/ngsi/ws` to the backend. Agent calls can take 300 seconds, and uploads can reach 64 MB, so the controller must allow both. With `nginx`, the chart sets the annotations for this. Traefik has no body limit or short read timeout by default.

The frontend's nginx configuration is in a ConfigMap, mounted over the image's template; a change to it restarts the frontend.

### Using it

Sign-in uses `keycloakUrl`, Keycloak's external address with `/auth` if it has it, for example `https://keycloak.example.org/auth`. Tokens must match the issuer that Scorpio checks, so don't use the in-cluster address. The platform's `scorpio` client in realm `iff` is used by default.

The context broker's check, in the System screen and `/api/diagnostics`, asks `…/ngsi-ld/v1/types` with the operator's token. When the broker doesn't answer 200, it shows the status, the address, whether a token was sent, and the start of the broker's answer (its `title` and `detail`, or its first 300 characters), with secrets masked. The usual causes, in order: nobody is signed in; `keycloakUrl` isn't the issuer the broker checks, which is Keycloak's external address; the user has no role on client `scorpio`; `ngsiTenant` names a tenant that doesn't exist.

The Data Explorer reads history from `pgrestUrl`. Set `ngsiContextUrl` if operators or the agent's lookups use short names on data with full IRIs.

The dataspace uses `gatewayUrl`, `gatewayKeycloakUrl` (the address the dataspace's services know Keycloak by, since they compare a token's issuer exactly), `gatewayKeycloakRealm`, `gatewayClientId` and `dataSharingPolicy`. With a gateway, `SETTINGS_ENCRYPTION_KEY` is required, or the backend does not start; `GATEWAY_CLIENT_SECRET` is needed only if the operator shouldn't enter it.

The IFRIC registry uses `ifricUrl`, including its port, and `factoryId`.

Alerts use `alertaUrl`, which must end in `/api`, and `ALERTA_API_KEY`.

Machine events use `callbackBaseUrl`, the backend as Scorpio reaches it from `iff`, filled in as `http://xana-pdt-backend.xana-pdt.svc.cluster.local:8000`, and `EVENT_WEBHOOK_SECRET`; empty `callbackBaseUrl` turns them off. With nobody signed in, they need a Keycloak client with a service account and read access to Scorpio: `keycloakServiceClientId` and `KEYCLOAK_SERVICE_CLIENT_SECRET`. The platform has no such client, so one has to be created. On data with full IRIs, set `machineWatchType` and `machineWatchAttributes` to the platform's names, with `status` in full. Alerts need the plugin loaded in Alerta, which the platform's chart doesn't do. See [Machine events](../backend/README.md#machine-events).

Finished runs move to incident history after `autoArchiveAfterS` seconds without a change; `0` turns it off.

Value hints read `fusekiUrl` and `fusekiDataset`. Set `fusekiGraphBase` to `http://<Fuseki's external host>/<realm>`, as the platform names its graphs after that host.

Live updates use `mqttBrokerUrl`, `mqttMgmtUrl` and, if Scorpio reaches the broker at another address, `mqttBrokerNotifyUrl`. Operators need `Factory-Admin` or `Factory-Reader` on client `scorpio`. A page served from another address than the UI's needs `wsAllowedOrigins`.

Traces go to Langfuse's own service unless `langfuseHost` names your server. Without the two Langfuse keys nothing is traced.

> **Warning: use TLS, and restrict who can reach the UI and the backend.** With no TLS Secret (`ingressTlsSecret`, empty outside `production`), the operator's password crosses the Ingress in plain HTTP. The backend also doesn't know who is calling. So while anyone is signed in, anyone who can reach it can:
>
> - pass the sign-in screen without credentials;
> - start runs that use the operator's token;
> - read the operator's name and e-mail;
> - sign the operator out, or replace the session with their own.
>
> See [Sign-in](../backend/README.md#sign-in).

### Language model

Set `llmProvider`, `llmModel` and `llmProviderName`, then one of these:

| Model server | Setting |
|---|---|
| Ollama | `ollamaUrl` |
| OpenVINO Model Server or another OpenAI-compatible server | `llmProvider: openai`, `openaiBaseUrl`, for example `http://ovms:8000/v3` |
| Anthropic or OpenAI | The API key, as a secret |


## Secrets

The backend's secrets go into a Secret the chart creates, never a ConfigMap. Each is listed in Section 3 of `default.yaml` with its shell variable, what it is for, when it is required, and how to get it:

| Key | Variable | Required |
|---|---|---|
| `anthropicApiKey` | `ANTHROPIC_API_KEY` | with `llmProvider: anthropic` |
| `openaiApiKey` | `OPENAI_API_KEY` | with `llmProvider: openai` and no `openaiBaseUrl` |
| `alertaApiKey` | `ALERTA_API_KEY` | for the alerts screen |
| `eventWebhookSecret` | `EVENT_WEBHOOK_SECRET` | with `callbackBaseUrl`, which is filled in |
| `keycloakServiceClientSecret` | `KEYCLOAK_SERVICE_CLIENT_SECRET` | with `keycloakServiceClientId` |
| `settingsEncryptionKey` | `SETTINGS_ENCRYPTION_KEY` | with `gatewayUrl` |
| `gatewayClientSecret` | `GATEWAY_CLIENT_SECRET` | never; else the operator enters it |
| `langfusePublicKey`, `langfuseSecretKey` | `LANGFUSE_PUBLIC_KEY`, `LANGFUSE_SECRET_KEY` | together, for traces |
| `databaseUsername`, `databasePassword` | `DATABASE_USERNAME`, `DATABASE_PASSWORD` | unless read when deploying, or both URLs given |
| `timescaleDbUrl`, `postgresMemoryUrl` | `TIMESCALE_DB_URL`, `POSTGRES_MEMORY_URL` | never |

Each comes from the first of these that gives a value:

1. the shell variable, when it is set and not empty, for example from your env file with `set -a; source …; set +a`;
2. the key in the environment file;
3. a lookup of the platform's Secrets when deploying (below).

The release's existing Secret is not a source: a run without a secret removes it, and a value the platform changed isn't kept stale.

### Read when deploying

During `apply` (or `sync`), the chart reads with Helm `lookup`, and copies into its own Secrets in `xana-pdt`:

- the database credentials, from `databaseCredentialsSecret` in `databaseCredentialsNamespace`;
- each `secretLookups` entry not already given, from its Secret's key, in its `namespace`.

A `namespace` is `$namespace` (XANA's own, the release's namespace, `xana-pdt`), `$platformNamespace` (`iff`), or a namespace's name, which is used as given. An entry without one is read in `platformNamespace`. Another `$` name stops the render. With the defaults:

| Secret | Kind | Read in | Gives |
|---|---|---|---|
| `xana-pdt-credentials` | XANA's own | `$namespace` (`xana-pdt`) | `EVENT_WEBHOOK_SECRET`, `SETTINGS_ENCRYPTION_KEY`, `GATEWAY_CLIENT_SECRET`, `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `LANGFUSE_PUBLIC_KEY`, `LANGFUSE_SECRET_KEY`, by variable name |
| `alerta` | the platform's | `$platformNamespace` (`iff`) | `ALERTA_API_KEY` (key `alerta-admin-key`) |
| `keycloak-client-secret-xana` | the platform's | `$platformNamespace` | `KEYCLOAK_SERVICE_CLIENT_SECRET` (key `CLIENT_SECRET`), a commented example to add with `keycloakServiceClientId` |
| `ngb.acid-cluster.credentials` (`databaseCredentialsSecret`) | the platform's | `databaseCredentialsNamespace`, default `$platformNamespace` | `DATABASE_USERNAME`, `DATABASE_PASSWORD`; `$namespace` reads a copy kept in `xana-pdt` |

So changing `namespace`, `platformNamespace` or `databaseCredentialsNamespace` moves the matching lookups. A lookup that finds nothing leaves the variable unset; that stops `apply` only if something needs it, naming the Secret it read. `NOTES` after `apply` lists what was read and what wasn't.

`xana-pdt-credentials` is XANA's own Secret, kept in `xana-pdt` next to XANA, which you create once, with a key per variable it should hold, for example:

```bash
kubectl create namespace xana-pdt      # if it isn't there yet
kubectl -n xana-pdt create secret generic xana-pdt-credentials \
  --from-literal=SETTINGS_ENCRYPTION_KEY="$(python -c 'from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())')" \
  --from-literal=EVENT_WEBHOOK_SECRET="$(openssl rand -hex 32)" \
  --from-file=ANTHROPIC_API_KEY=./anthropic-key.txt
```

**Permissions.** The lookups run with your own kubeconfig: you need `get` on those Secrets, in `xana-pdt` and `iff`, and on ServiceAccount `default` in `iff` (and in any other namespace an entry names), besides what installing in `xana-pdt` needs. Nothing is granted inside the cluster: XANA's Pods get no access to the platform's Secrets. A lookup you may not make stops `apply` with Helm's own error, naming the resource; give that secret in the shell instead.

**Without a cluster.** `helmfile template` and `helm template` read nothing; the chart tells this from "not found" by looking up ServiceAccount `default` in `platformNamespace`. The rendered database and backend Secrets then carry a comment, "The platform's Secrets weren't read: this render had no cluster…", listing what wasn't read, and no check a lookup could satisfy stops the render. `helmfile apply` diffs first, and helm-diff renders without cluster access unless asked: the diff then shows the looked-up keys as removed, and `apply` goes on to `sync`, which reads them. `--suppress-secrets` hides that noise; `--diff-args=--dry-run=server` lets the diff read them too.

### Checked when deploying

The checks the backend makes when it starts are made by the chart when deploying, with the backend's own messages:

- `gatewayUrl` needs `SETTINGS_ENCRYPTION_KEY`, which has to be a Fernet key (the message gives the command), and `gatewayKeycloakUrl`;
- `callbackBaseUrl` needs `EVENT_WEBHOOK_SECRET` (`openssl rand -hex 32`; or empty `callbackBaseUrl` for no machine events);
- `keycloakServiceClientId` and `KEYCLOAK_SERVICE_CLIENT_SECRET` go together, and the ID needs `keycloakUrl`;
- the two Langfuse keys go together, and `LANGFUSE_HOST` and `LANGFUSE_BASE_URL` must name the same address;
- `llmProvider: anthropic` needs `ANTHROPIC_API_KEY`; `llmProvider: openai` needs `OPENAI_API_KEY` or `openaiBaseUrl`;
- `alertaUrl` ends in `/api`; `fusekiDataset` and the table names are plain names; the API keys and `EVENT_WEBHOOK_SECRET` have no spaces.

`LANGFUSE_BASE_URL` is accepted as another name for `LANGFUSE_HOST`, from the shell, as Langfuse's own instructions write it either way. It is the one setting that isn't a secret and still comes from the shell.

### The cluster-secrets helper

**`envs/iff-cluster.sh`** is no longer needed, as the chart reads the same Secrets when deploying; it still works, and what it exports counts as the shell. Sourced from bash, it reads them with `kubectl` and exports them: from the platform's namespace, `IFF_NAMESPACE` (default `iff`), `ALERTA_API_KEY` from Secret `alerta` (key `alerta-admin-key`), `KEYCLOAK_SERVICE_CLIENT_SECRET` from `keycloak-client-secret-xana` (key `CLIENT_SECRET`), and `DATABASE_USERNAME` and `DATABASE_PASSWORD` from the operator's Secret `ngb.acid-cluster.credentials` (keys `username` and `password`); and from XANA's namespace, `XANA_NAMESPACE` (default `xana-pdt`), the others from `xana-pdt-credentials`, by variable name. It prints both namespaces. A namespace it can't read has its variables reported as not found; only when it can read neither does the `source` fail.

- It prints the kube context it reads from, so you can check it is the cluster you mean, and only variable names, never a value. It writes no file.
- A variable already set and not empty is kept, and exported if it wasn't, so `helmfile` sees it. If it differs from the cluster's value, it says so, without printing either.
- A missing Secret or key is reported by name and skipped.
- Without `kubectl`, or when it can't read the namespace's Secrets, it exports nothing and the `source` fails with status 1. Under `set -e` that ends the shell; `source envs/iff-cluster.sh || true` goes on regardless.
- It needs bash. In zsh or another shell it stops with a message and exports nothing; run `bash`, then source it there.
- `XANA_NAMESPACE`, `IFF_NAMESPACE`, `IFF_ALERTA_SECRET`, `IFF_KEYCLOAK_CLIENT_SECRET`, `IFF_XANA_SECRET` and `IFF_DATABASE_SECRET` change the namespaces and Secret names. `XANA_NAMESPACE` is not one of the earlier names the render refuses.

### Earlier names

The variables an earlier version read, `XANA_<NAME>` for these secrets and `XANA_EXISTING_SECRET`, `XANA_INGRESS_HOST`, `XANA_KEYCLOAK_URL`, `XANA_LANGFUSE_HOST` and `XANA_AUTO_ARCHIVE_AFTER_S`, are no longer read. If one is still set, the render stops and names what replaces it, without showing its value. Rename the secrets to `<NAME>`, and move the others into your environment file (`existingSecret` becomes `secretLookups` entries). An environment file that still sets `ingressClass`, `existingSecret` or `extraConfig` stops the render the same way: use `ingressClassName`, `secretLookups`, or each setting's own key.

> **Warning: `TIMESCALE_DB_URL` and `POSTGRES_MEMORY_URL` in your shell are used.** They are the backend's own variable names, so a developer shell that has them set, for example for `docker compose`, hands them to `helmfile` too. They then go into the Secret and replace the URLs the chart builds from the database credentials, pointing the cluster's backend at your local database. Unset them before `apply`: `unset TIMESCALE_DB_URL POSTGRES_MEMORY_URL`.

Never commit a secret. In CI, `test/check_values.py` checks that the committed environment files hold no secret value and no address outside the defaults and placeholders.

## What changed from the previous layout

For an install made with the layout before this one:

- **Addresses** are written out in `default.yaml`. A copy of the old `default.yaml`, with empty address keys, gets no defaults now: start from the new file and carry your values across. `platformNamespace` no longer changes any address.
- **`localAndIonos`** is gone. Put its values into Section 2, and use `-e production` for the production overrides.
- **Database credentials** are read from the operator's Secret when deploying. `envs/iff-cluster.sh` is optional. A copy of that Secret in `xana-pdt` is no longer used: `databaseCredentialsSecret` names the Secret in `platformNamespace`.
- **`secretLookups`** are read when deploying and copied into the chart's Secret, not read by the Pod. An entry for a Secret in `xana-pdt` needs `namespace: xana-pdt`. After a change to a looked-up Secret, `apply` again.
- **`xana-pdt-credentials`** is read in `xana-pdt` now, not `iff`. If you created it in `iff`, move it (the copy command in [Namespaces](#namespaces) works with the namespaces swapped), or set those entries' `namespace` to `$platformNamespace`.
- **Checks** of paired settings stop `apply`, not the Pod. With the default `callbackBaseUrl`, that includes `EVENT_WEBHOOK_SECRET`.
- **A release upgraded in place from before the chart wrote its Secrets as `data`** keeps a dropped secret once, as Helm's merge keeps a live key the old manifest had only under `stringData`. Delete the Secret once (`kubectl -n <namespace> delete secret xana-pdt-backend`), then `apply`. A fresh install in `xana-pdt` isn't affected.

## Limits

- The backend runs as one replica, because runs and their streams are held in the process. An upgrade restarts it, and stored runs continue afterwards.

## Images

To deploy to your own cluster, build the images and push them to your registry with `build.sh` at the repository root, then point an environment at them:

```bash
docker login <registry>                       # if the registry needs it
REGISTRY=<registry>/<path> IMAGE_TAG=1.2.3 ./build.sh
```

It pushes `<registry>/<path>/xana-ai-pdt-backend:1.2.3` and `<registry>/<path>/xana-ai-pdt-frontend:1.2.3`, the names the chart renders from `imageRegistry: <registry>/<path>` and `imageTag: "1.2.3"` in your environment file.

- `REGISTRY` defaults to `k3d-iff.localhost:12345` and `IMAGE_TAG` to `latest`. `REGISTRY` is a registry and optional path, `host[:port][/path…]`, with no spaces and lower-case path parts; a value that isn't stops the script before building, naming where it came from. To keep yours, copy `.env.example` at the repository root to `.env` (git-ignored); shell variables win over it. It is read as `KEY=VALUE` lines for those two keys only, never sourced or run; a leading `export ` and spaces around `=` are accepted.
- `./build.sh backend` or `./build.sh frontend` builds one image; `--no-push` builds without pushing; `--help` shows the usage. It prints the registry, tag and names first, builds every selected image before pushing any, and stops at the first failure, saying what failed.
- A registry served over plain HTTP under another name than `localhost`, such as k3d's, has to be listed in Docker's `insecure-registries` first.

CI builds both images with `./build.sh --no-push` on every related Pull Request. Publishing to `ghcr.io/industryfusion` happens only from a version tag.

## Trying it on a local cluster

`test/` has stand-ins for the platform's services, and the `Deployment` workflow installs this way on every related Pull Request, on the `default` environment with values for the local cluster. With [kind](https://kind.sigs.k8s.io/), from the repository root:

```bash
kind create cluster --name xana --config helm/test/kind.yaml
docker build -t xana-local/xana-ai-pdt-backend:dev backend
docker build -t xana-local/xana-ai-pdt-frontend:dev frontend
kind load docker-image --name xana xana-local/xana-ai-pdt-backend:dev xana-local/xana-ai-pdt-frontend:dev
kubectl apply -f https://raw.githubusercontent.com/kubernetes/ingress-nginx/controller-v1.12.1/deploy/static/provider/kind/deploy.yaml
kubectl create namespace iff
kubectl -n iff create configmap xana-db-init --from-file=backend/db-init
kubectl -n iff apply -f helm/test/stand-ins.yaml
kubectl -n iff apply -f helm/test/sample-data.yaml
kubectl create namespace xana-pdt
kubectl -n xana-pdt apply -f helm/test/xana-pdt-test-secrets.yaml
helm/test/local-values.sh > /tmp/xana-local-values.yaml
(cd helm && ./bootstrap.sh && ./helmfile -e default --state-values-file /tmp/xana-local-values.yaml sync)
helm/test/check_cluster_secrets.sh xana-pdt
python helm/test/smoke.py http://127.0.0.1 run --host xana.localhost
```

`local-values.sh` prints the values: the locally built images, the scripted model, the stand-in database without TLS, nginx on `xana.localhost`, no machine events, and two `secretLookups`, one from a Secret in `xana-pdt` by its `namespace` and one from `iff`. The database credentials are read from the stand-in operator's Secret when deploying. The stand-ins are in `iff`, XANA in `xana-pdt`, as on a real cluster. The stand-in database password needs percent-encoding, to exercise the chart's. `helm/test/iff_cluster_test.sh` checks `envs/iff-cluster.sh` against the stand-in Secrets, and `check_cluster_secrets.sh` that the backend names only Secrets of its own namespace, builds its URLs for `acid-cluster.iff.svc.cluster.local` from the credentials read when deploying, gets both looked-up variables, and reaches both databases.

The stand-in database trusts every connection, and the stand-in Secrets hold test values. Use this on a local cluster only.
