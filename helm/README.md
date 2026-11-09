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
├── helmfile.yaml.gotmpl    # the release and the environments default, production, localAndIonos
├── values.yaml.gotmpl      # turns the environment keys and shell variables into the chart's values
├── environment/
│   ├── default.yaml        # every key, with its default
│   ├── production.yaml     # over default.yaml
│   └── localAndIonos.yaml  # over production.yaml; placeholders only
├── envs/
│   └── iff-cluster.sh      # exports the backend's secrets from the cluster's Secrets
├── charts/xana-pdt/        # the chart
└── test/                   # checks, stand-ins and the local test cluster
```

This is the layout of the IndustryFusion platform's charts (DigitalTwin, Dataspace).

## Install

From `helm/`, once:

```bash
./bootstrap.sh
```

It downloads Helmfile 1.1.9 for your system into `helm/helmfile`, checks its SHA-256 against the checksum in the script, and does nothing if that version is already there. `HELMFILE_DOWNLOAD_URL` points it at a mirror.

Then, with the secrets in the shell (see [Secrets](#secrets)):

```bash
source envs/iff-cluster.sh        # the database credentials and secrets from the platform's Secrets
./helmfile -e default apply
```

## Namespaces

XANA goes in its own namespace, `xana-pdt` (`namespace`), and reaches the platform in `iff` (`platformNamespace`):

- The platform's default addresses name `platformNamespace`, for example `http://scorpio-all-in-one-runner.iff:9090` (see [Platform addresses](#platform-addresses)).
- A Pod reads Secrets only in its own namespace, and an Ingress finds its TLS Secret only there, so nothing XANA names is in `iff`. The database credentials reach XANA through `envs/iff-cluster.sh` (see [Database credentials](#database-credentials)). Every other Secret the chart names has to be in `xana-pdt`: those in `secretLookups`, `databaseCaSecret`, `ingressTlsSecret` (`xana-tls` in `production`), and the chart's `imagePullSecrets`.
- To install next to the platform instead, set `namespace: iff`. Then `databaseCredentialsSecret: ngb.acid-cluster.credentials` works without copying.

**Moving an earlier install from `iff`.** `apply` doesn't move a release: it would install a second one in `xana-pdt` next to the old one. Two releases would have Ingresses for the same host and path, so the new one is refused by ingress-nginx's admission check, or traffic keeps going to the old one. Two backends would also share the database, the automatic archive, the dataspace inbox and the Scorpio subscriptions, and handle every event twice. So, in this order:

1. Copy into `xana-pdt` the Secrets XANA names there (see the list above): the TLS Secret, `ingressTlsSecret`, first of all, or the Ingress serves the controller's default certificate, and any `imagePullSecrets`, `secretLookups` and `databaseCaSecret` Secrets.
2. In your own environment files, clear or qualify the addresses copied from the old defaults: short names such as `ngsiUrl: http://scorpio-all-in-one-runner:9090` or `databaseHost: acid-cluster` resolve only inside `iff`. Leave them empty for the defaults in `platformNamespace`, or write `<service>.iff`. Set `callbackBaseUrl` to `http://xana-pdt-backend.xana-pdt:8000`: from `iff`, the short `xana-pdt-backend` names the old release.
3. Remove the old release: `helm -n iff uninstall xana-pdt`. The runs and incidents are in the platform's database and are kept. Its Scorpio subscription stays until the new backend replaces it.
4. Then `source envs/iff-cluster.sh` and `./helmfile -e <environment> apply`, installing in `xana-pdt`.

**Network policies.** A NetworkPolicy in `iff` that admits only its own namespace has to admit `xana-pdt` too: from XANA to the platform's services; for machine events, from Scorpio to XANA's backend; and for alerts, from Alerta's plugin to the backend's `/events/alert`. One in `xana-pdt` has to admit both ways likewise.

To copy a Secret from `iff` into `xana-pdt`, for `secretLookups` or `databaseCaSecret`:

```bash
kubectl -n iff get secret <name> -o json \
  | jq 'del(.metadata.namespace, .metadata.uid, .metadata.resourceVersion, .metadata.creationTimestamp, .metadata.ownerReferences, .metadata.managedFields)' \
  | kubectl -n xana-pdt apply -f -
```

A copy doesn't follow later changes in `iff`: copy it again, then `kubectl -n xana-pdt rollout restart deploy/xana-pdt-backend`.

Check it:

```bash
kubectl -n xana-pdt get pods
kubectl -n xana-pdt exec deploy/xana-pdt-backend -- \
  python -c "import httpx; print(httpx.get('http://localhost:8000/api/diagnostics?fresh=true').text)"
```

To remove the release: `./helmfile -e default destroy`. Data in the database is kept.

## Environments

| Environment | Files, a later one winning | For |
|---|---|---|
| `default` | `default.yaml` | Any cluster running the platform, with the published images |
| `production` | `default.yaml`, `production.yaml` | A pinned image tag and a TLS Secret |
| `localAndIonos` | `default.yaml`, `production.yaml`, `localAndIonos.yaml` | A local-and-IONOS cluster |

`localAndIonos.yaml` holds only placeholders, under the reserved `.invalid` domain or reading `replace-me`; fill in every one for your cluster before `./helmfile -e localAndIonos apply`. A placeholder left in never reaches another host, as `.invalid` names don't resolve, but not every one fails loudly:

- `imageRegistry` under `.invalid`, or `imageTag: replace-me`: the Pods can't pull their images and stay in `ImagePullBackOff`, unless your registry happens to hold a tag of that name.
- An address under `.invalid` (`keycloakUrl`, the platform services, `databaseHost`, the dataspace): the backend starts, and the System screen and `/api/diagnostics` show that connection as failing. Sign-in fails with `keycloakUrl` left in, and runs can't be stored with `databaseHost` left in.
- `ingressHost` under `.invalid`: the Ingress is created for a host no client asks for, so XANA isn't reachable through it, and nothing reports an error.
- `ingressClassName: replace-me`: no Ingress controller picks the Ingress up, so XANA isn't reachable from outside, and nothing reports an error. Check `kubectl -n xana-pdt get ingress` for an address.
- `ingressTlsSecret: replace-me`: the controller doesn't find that Secret; most then serve their default certificate, so browsers warn.

Your filled-in copy is yours to keep out of the repository. In CI, `test/check_environments.py` checks the layering, that the committed file holds only marked placeholders and no key named like a secret, and that no address `localAndIonos` renders is still inherited.

## Configuration

Every key is in `environment/default.yaml` with its default. An environment file sets only what differs. Each setting becomes the backend variable named below, in the backend's ConfigMap; an empty value leaves the variable out, so the backend's own default applies. See [`backend/.env.example`](../backend/.env.example) for what each variable does.

### Release and images

| Key | Default | What it is |
|---|---|---|
| `namespace` | `xana-pdt` | The release's namespace |
| `platformNamespace` | `iff` | The platform's namespace, in the default addresses |
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
| `ngsiUrl` | `NGSI_URL` | `http://scorpio-all-in-one-runner.iff:9090` * |
| `ngsiTenant` | `NGSI_TENANT` | |
| `ngsiContextUrl` | `NGSI_CONTEXT_URL` | |
| `ngsiAllowedContexts` | `NGSI_ALLOWED_CONTEXTS` | |
| `pgrestUrl` | `PGREST_URL` | `http://pgrest.iff:3000` * |
| `callbackBaseUrl` | `CALLBACK_BASE_URL` | |
| `machineWatchType` | `MACHINE_WATCH_TYPE` | `Machine` |
| `machineWatchAttributes` | `MACHINE_WATCH_ATTRIBUTES` | `status,errorCode,alarmLevel,faultCode` |
| `alertaUrl` | `ALERTA_URL` | `http://alerta.iff:8080/api` * |
| `alertsRefreshIntervalS` | `ALERTS_REFRESH_INTERVAL_S` | `30` |
| `gatewayUrl` | `GATEWAY_URL` | |
| `gatewayKeycloakUrl` | `GATEWAY_KEYCLOAK_URL` | |
| `gatewayKeycloakRealm` | `GATEWAY_KEYCLOAK_REALM` | `dataspace` |
| `gatewayClientId` | `GATEWAY_CLIENT_ID` | |
| `dataSharingPolicy` | `DATA_SHARING_POLICY` | `minimal` |
| `inboxPollIntervalS` | `INBOX_POLL_INTERVAL_S` | `15` |
| `ifricUrl` | `IFRIC_URL` | |
| `fusekiUrl` | `FUSEKI_URL` | `http://fuseki.iff:3030` * |
| `fusekiDataset` | `FUSEKI_DATASET` | `iff` |
| `fusekiGraphBase` | `FUSEKI_GRAPH_BASE` | `http://fuseki.local/iff` |
| `mqttBrokerUrl` | `MQTT_BROKER_URL` | `mqtt://emqx-listeners.iff:1883` * |
| `mqttMgmtUrl` | `MQTT_MGMT_URL` | `http://emqx-dashboard.iff:18083` * |
| `mqttBrokerNotifyUrl` | `MQTT_BROKER_NOTIFY_URL` | |
| `wsAllowedOrigins` | `WS_ALLOWED_ORIGINS` | |
| `langfuseHost` | `LANGFUSE_HOST` | |
| `postgresSslMode` | `POSTGRES_SSLMODE` | `require` |
| `timescaleTable` | `TIMESCALE_TABLE` | `attributes` |
| `timescaleEntityTable` | `TIMESCALE_ENTITY_TABLE` | `entities` |
| `healthTimeoutS` | `HEALTH_TIMEOUT_S` | `3` |
| `healthCacheS` | `HEALTH_CACHE_S` | `10` |
| `logLevel` | `LOG_LEVEL` | `INFO` |

### Platform addresses

The defaults marked * in the table above, and `databaseHost`, are empty in `default.yaml`: an empty one is the platform's Service in `platformNamespace`, `<service>.<platformNamespace>`, which resolves from any namespace. With `platformNamespace: platform`, `ngsiUrl` becomes `http://scorpio-all-in-one-runner.platform:9090`, and so on. An address you set is used as given.

`platformNamespace` takes effect through Helmfile only, in `values.yaml.gotmpl`. The chart's own [`values.yaml`](charts/xana-pdt/values.yaml), for an install with plain `helm`, has the addresses with `.iff` written out; with another platform namespace, set them there.

### Database

| Key | Default | What it is |
|---|---|---|
| `databaseHost`, `databasePort` | `acid-cluster.iff`, `5432` | The PostgreSQL server; an empty host is `acid-cluster` in `platformNamespace` |
| `databaseTimeseriesName`, `databaseMemoryName` | `tsdb`, `memory` | The two databases |
| `databaseCredentialsSecret` | | A Secret in `xana-pdt` with keys `username` and `password`, for example the operator's Secret copied there; used only without `DATABASE_USERNAME` and `DATABASE_PASSWORD` |
| `databaseCaSecret` | | A Secret holding the CA certificate as `ca.crt` |

Unless `TIMESCALE_DB_URL` and `POSTGRES_MEMORY_URL` are given, as secrets or by `secretLookups`, the Pod builds them when it starts from the database credentials, host, port and database names; only a missing one is built.

#### Database credentials

The credentials come from the first of these:

1. **`DATABASE_USERNAME` and `DATABASE_PASSWORD`**, which `envs/iff-cluster.sh` exports from the operator's Secret in `iff` (or the keys `databaseUsername` and `databasePassword`, empty in committed files; the shell wins). The chart keeps them in its own Secret, `xana-pdt-database`, percent-encoded, so a password with `@`, `:`, `/`, `%`, `+`, spaces or any other character reaches the database unchanged.
2. **`databaseCredentialsSecret`**, a Secret in `xana-pdt` you copied there (see [Namespaces](#namespaces)). Its values are used as they are, so they must not need URL encoding, which holds for the operator's generated passwords.

With neither, the render stops and names these options. It also stops when only one of the two variables is set.

**After a password change on the platform**, XANA's copy is stale: the System screen and `/api/diagnostics` show the databases failing. In a new shell, or after `unset DATABASE_USERNAME DATABASE_PASSWORD`, source `envs/iff-cluster.sh` again, then `./helmfile -e <environment> apply`. The chart's Secret changes, and the backend restarts with it. In a shell that still holds the old values, the helper keeps them and says they differ from the cluster's. With a copied Secret, copy it again and restart the backend.

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

The Data Explorer reads history from `pgrestUrl`. Set `ngsiContextUrl` if operators or the agent's lookups use short names on data with full IRIs.

The dataspace uses `gatewayUrl`, `gatewayKeycloakUrl` (the address the dataspace's services know Keycloak by, since they compare a token's issuer exactly), `gatewayKeycloakRealm`, `gatewayClientId` and `dataSharingPolicy`. With a gateway, `SETTINGS_ENCRYPTION_KEY` is required, or the backend does not start; `GATEWAY_CLIENT_SECRET` is needed only if the operator shouldn't enter it.

The IFRIC registry uses `ifricUrl`, including its port, and `factoryId`.

Alerts use `alertaUrl`, which must end in `/api`, and `ALERTA_API_KEY`.

Machine events use `callbackBaseUrl`, the backend as Scorpio reaches it from `iff`, for example `http://xana-pdt-backend.xana-pdt:8000`, and `EVENT_WEBHOOK_SECRET`. With nobody signed in, they need a Keycloak client with a service account and read access to Scorpio: `keycloakServiceClientId` and `KEYCLOAK_SERVICE_CLIENT_SECRET`. The platform has no such client, so one has to be created. On data with full IRIs, set `machineWatchType` and `machineWatchAttributes` to the platform's names, with `status` in full. Alerts need the plugin loaded in Alerta, which the platform's chart doesn't do. See [Machine events](../backend/README.md#machine-events).

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

The backend's secrets go into a Secret the chart creates, never a ConfigMap. Each has an environment key, empty in every committed file, and the backend's variable name, which is also its shell variable:

| Key | Variable |
|---|---|
| `anthropicApiKey` | `ANTHROPIC_API_KEY` |
| `openaiApiKey` | `OPENAI_API_KEY` |
| `langfusePublicKey`, `langfuseSecretKey` | `LANGFUSE_PUBLIC_KEY`, `LANGFUSE_SECRET_KEY` |
| `keycloakServiceClientSecret` | `KEYCLOAK_SERVICE_CLIENT_SECRET` |
| `eventWebhookSecret` | `EVENT_WEBHOOK_SECRET` |
| `gatewayClientSecret` | `GATEWAY_CLIENT_SECRET` |
| `settingsEncryptionKey` | `SETTINGS_ENCRYPTION_KEY` |
| `alertaApiKey` | `ALERTA_API_KEY` |
| `timescaleDbUrl`, `postgresMemoryUrl` | `TIMESCALE_DB_URL`, `POSTGRES_MEMORY_URL` |

A shell variable wins over the key when it is set and not empty; an empty one is ignored, and the key applies:

```bash
ANTHROPIC_API_KEY="$KEY" ./helmfile -e default apply
```

**Set them on every `apply`.** Helmfile doesn't keep earlier values, so a run without them removes them from the Secret. To avoid that, read them from the cluster.

> **A release upgraded in place from an earlier version can keep a dropped secret once.** The chart now writes its Secrets as `data`; earlier versions wrote `stringData`, and Helm's merge keeps a live key the old manifest had only under `stringData`. So on the first upgrade of a release that stays in its namespace, a secret you leave out stays in the Secret. Delete the Secret once (`kubectl -n <namespace> delete secret xana-pdt-backend`), then `apply`. A fresh install in `xana-pdt` isn't affected.

To read them from the cluster:

- **`envs/iff-cluster.sh`**, sourced from bash, reads them with `kubectl` from Secrets in namespace `iff` and exports them: `ALERTA_API_KEY` from Secret `alerta` (key `alerta-admin-key`), `KEYCLOAK_SERVICE_CLIENT_SECRET` from `keycloak-client-secret-xana` (key `CLIENT_SECRET`), `DATABASE_USERNAME` and `DATABASE_PASSWORD` from the operator's Secret `ngb.acid-cluster.credentials` (keys `username` and `password`), and the others from `xana-pdt-credentials`, by variable name.
  - It prints the kube context it reads from, so you can check it is the cluster you mean, and only variable names, never a value. It writes no file.
  - A variable already set and not empty is kept, and exported if it wasn't, so `helmfile` sees it. If it differs from the cluster's value, it says so, without printing either.
  - A missing Secret or key is reported by name and skipped.
  - Without `kubectl`, or when it can't read the namespace's Secrets, it exports nothing and the `source` fails with status 1. Under `set -e` that ends the shell; `source envs/iff-cluster.sh || true` goes on regardless.
  - It needs bash. In zsh or another shell it stops with a message and exports nothing; run `bash`, then source it there.
  - `IFF_NAMESPACE`, `IFF_ALERTA_SECRET`, `IFF_KEYCLOAK_CLIENT_SECRET`, `IFF_XANA_SECRET` and `IFF_DATABASE_SECRET` change the namespace and Secret names.

  `xana-pdt-credentials` is XANA's own Secret, kept in `iff` with the others the helper reads, which you create once, with a key per variable it should hold, for example:

  ```bash
  kubectl -n iff create secret generic xana-pdt-credentials \
    --from-literal=SETTINGS_ENCRYPTION_KEY="$(openssl rand -base64 32)" \
    --from-literal=EVENT_WEBHOOK_SECRET="$(openssl rand -hex 32)" \
    --from-file=ANTHROPIC_API_KEY=./anthropic-key.txt
  ```

  Its keys can be any of `GATEWAY_CLIENT_SECRET`, `SETTINGS_ENCRYPTION_KEY`, `EVENT_WEBHOOK_SECRET`, `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `LANGFUSE_PUBLIC_KEY` and `LANGFUSE_SECRET_KEY`; leave out the ones you don't use. Reading a key from a file keeps it out of your shell history.
- **`secretLookups`** in the environment file makes the Pod read a variable from a Secret's key when it starts, so the value never passes through Helmfile:

  ```yaml
  secretLookups:
    - { variable: ALERTA_API_KEY, secret: alerta, key: alerta-admin-key }
  ```

  A variable also given as a secret, from the file or the shell, is taken from there instead. The render stops for a variable listed twice, and for one the chart sets itself: `DB_USER`, `DB_PASSWORD`, and a database URL it builds.

The variables an earlier version read, `XANA_<NAME>` for these secrets and `XANA_EXISTING_SECRET`, `XANA_INGRESS_HOST`, `XANA_KEYCLOAK_URL`, `XANA_LANGFUSE_HOST` and `XANA_AUTO_ARCHIVE_AFTER_S`, are no longer read. If one is still set, the render stops and names what replaces it, without showing its value. Rename the secrets to `<NAME>`, and move the others into your environment file (`existingSecret` becomes `secretLookups` entries). An environment file that still sets `ingressClass`, `existingSecret` or `extraConfig` stops the render the same way: use `ingressClassName`, `secretLookups`, or each setting's own key.

> **Warning: `TIMESCALE_DB_URL` and `POSTGRES_MEMORY_URL` in your shell are used.** They are the backend's own variable names, so a developer shell that has them set, for example for `docker compose`, hands them to `helmfile` too. They then go into the Secret and replace the URLs the chart builds from the database credentials, pointing the cluster's backend at your local database. Unset them before `apply`: `unset TIMESCALE_DB_URL POSTGRES_MEMORY_URL`.

Never commit a secret. In CI, `test/check_values.py` checks that the committed environment files hold no secret value and no address outside the defaults and placeholders.

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
(cd helm && ./bootstrap.sh && source envs/iff-cluster.sh && unset KEYCLOAK_SERVICE_CLIENT_SECRET \
  && ./helmfile -e default --state-values-file /tmp/xana-local-values.yaml sync)
helm/test/check_cluster_secrets.sh xana-pdt
python helm/test/smoke.py http://127.0.0.1 run --host xana.localhost
```

`local-values.sh` prints the values: the locally built images, the scripted model, the stand-in database without TLS, nginx on `xana.localhost`, and `EVENT_WEBHOOK_SECRET` through `secretLookups`. The stand-ins are in `iff`, XANA in `xana-pdt`, as on a real cluster. The stand-in database password needs percent-encoding, to exercise the chart's. `helm/test/iff_cluster_test.sh` checks `envs/iff-cluster.sh` against the stand-in Secrets, and `check_cluster_secrets.sh` that the backend names only Secrets of its own namespace, builds its URLs for `acid-cluster.iff` and reaches both databases.

The stand-in database trusts every connection, and the stand-in Secrets hold test values. Use this on a local cluster only.
