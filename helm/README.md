# Deploying XANA AI PDT on Kubernetes

Installs the operator UI and backend next to the [digital twin platform](https://github.com/IndustryFusion/DigitalTwin), with Helm 3 and [Helmfile](https://helmfile.readthedocs.io/) 1.x.

## What it needs

- A cluster running the platform, and `kubectl` pointing at it.
- Images: `xana-ai-pdt-backend` and `xana-ai-pdt-frontend`. A `v*` tag publishes them to `ghcr.io/industryfusion`. To build your own, see [Images](#images).
- A language model the cluster can reach. See [Language model](#language-model).

The platform's PostgreSQL chart already declares the `memory` and `tsdb` databases, and its operator generates the `ngb.acid-cluster.credentials` Secret.

## Install

From `helm/`:

```bash
XANA_INGRESS_HOST=xana.example.org helmfile -e default sync
```

The release goes in namespace `iff`, next to the platform, because a Pod can only read Secrets in its own namespace. To use another namespace, change `namespace` in `environment/default.yaml`, and name an existing Secret (see [Secrets](#secrets)).

Check it:

```bash
kubectl -n iff get pods
kubectl -n iff exec deploy/xana-pdt-backend -- \
  python -c "import httpx; print(httpx.get('http://localhost:8000/api/diagnostics?fresh=true').text)"
```

`production` adds a pinned image tag and a TLS Secret: `helmfile -e production sync`.

To remove the release: `helmfile -e default destroy`. Data in the database is kept.

## Configuration

Settings are in `environment/default.yaml`. `values.yaml.gotmpl` passes them to the chart, and the chart's [`values.yaml`](charts/xana-pdt/values.yaml) lists everything it accepts. For any other backend setting from [`backend/.env.example`](../backend/.env.example) that is not secret, such as `LLM_NUM_CTX` or `TIMESCALE_TABLE`, add it to `extraConfig`:

```yaml
extraConfig:
  LLM_NUM_CTX: 32768
```

Default addresses, in the release's namespace:

| Service | Address |
|---|---|
| Scorpio | `scorpio-all-in-one-runner:9090` |
| TimescaleDB | `acid-cluster:5432/tsdb` |
| Memory database | `acid-cluster:5432/memory` |

Database connections use TLS (`POSTGRES_SSLMODE: require`), which encrypts the connection but doesn't check the server. To check it, set `postgresSslMode` to `verify-ca` or `verify-full`, and `databaseCaSecret` to a Secret holding the CA certificate under key `ca.crt`. The chart mounts it and sets `POSTGRES_SSLROOTCERT`.

### Sign-in

The Data Explorer reads history from `pgrestUrl` (the platform's `pgrest` service). Set `ngsiContextUrl` if operators or the agent's lookups use short names on data with full IRIs.

The dataspace uses `gatewayUrl`, `gatewayKeycloakUrl` (the address the dataspace's services know Keycloak by, since they compare a token's issuer exactly), `gatewayKeycloakRealm`, `gatewayClientId` and `dataSharingPolicy`. With a gateway, `SETTINGS_ENCRYPTION_KEY` is required, or the backend does not start: set it with `XANA_SETTINGS_ENCRYPTION_KEY`, and the client secret, if the operator shouldn't enter it, with `XANA_GATEWAY_CLIENT_SECRET`, or either in the existing secret.

The IFRIC registry uses `ifricUrl`, including its port, and `factoryId`.

Alerts use `alertaUrl`, which must end in `/api`. Set the key with `XANA_ALERTA_API_KEY`, or as `ALERTA_API_KEY` in the existing secret.

Machine events use `callbackBaseUrl`, the backend as Scorpio reaches it, and `XANA_EVENT_WEBHOOK_SECRET`, or `EVENT_WEBHOOK_SECRET` in the existing secret. With nobody signed in, they need a Keycloak client with a service account and read access to Scorpio: `keycloakServiceClientId`, and `XANA_KEYCLOAK_SERVICE_CLIENT_SECRET`, or `KEYCLOAK_SERVICE_CLIENT_SECRET` in the existing secret. The platform has no such client, so one has to be created. On data with full IRIs, set `machineWatchType` and `machineWatchAttributes` to the platform's names, with `status` in full. Alerts need the plugin loaded in Alerta, which the platform's chart doesn't do. See [Machine events](../backend/README.md#machine-events).

Finished runs move to incident history after `autoArchiveAfterS` seconds without a change, 3600 by default; `XANA_AUTO_ARCHIVE_AFTER_S` overrides it, and `0` turns it off.

Value hints read `fusekiUrl` and `fusekiDataset`. Set `fusekiGraphBase` to `http://<Fuseki's external host>/<realm>`, as the platform names its graphs after that host.

Live updates use `mqttBrokerUrl`, `mqttMgmtUrl` and, if Scorpio reaches the broker at another address, `mqttBrokerNotifyUrl`. Operators need `Factory-Admin` or `Factory-Reader` on client `scorpio`. A page served from another address than the UI's needs `WS_ALLOWED_ORIGINS` in `extraConfig`.

Set `XANA_KEYCLOAK_URL` to Keycloak's external address, for example `https://keycloak.example.org/auth`. Tokens must match the issuer that Scorpio checks, so don't use the in-cluster address. The platform's `scorpio` client in realm `iff` is used by default.

> **Warning: use TLS, and restrict who can reach the UI and the backend.** With no TLS Secret (`ingressTlsSecret`, empty by default outside `production`), the operator's password crosses the Ingress in plain HTTP. The backend also doesn't know who is calling. So while anyone is signed in, anyone who can reach it can:
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

### Secrets

The backend takes its secrets from the first of these that applies:

1. **`secrets.existingSecret`:** a Secret holding each secret setting by variable name, including `TIMESCALE_DB_URL` and `POSTGRES_MEMORY_URL`. Set it with `XANA_EXISTING_SECRET`.
2. **`database.credentialsSecret`:** the operator's Secret, with keys `username` and `password`. The chart builds the two database URLs from it. Its password must not need URL encoding, which holds for generated passwords.
3. **`secrets.values`:** values given at install time, such as an API key, kept in a Secret the chart creates. With 2, these supply everything other than the database URLs.

Traces go to Langfuse's own service unless `langfuseHost`, or `XANA_LANGFUSE_HOST` from the shell, names your server; it is passed as `LANGFUSE_HOST` in the backend's configuration. Without the two keys nothing is traced.

For 3, Helmfile reads `XANA_ANTHROPIC_API_KEY`, `XANA_OPENAI_API_KEY`, `XANA_LANGFUSE_PUBLIC_KEY` and `XANA_LANGFUSE_SECRET_KEY` from the shell:

```bash
XANA_ANTHROPIC_API_KEY="$KEY" helmfile -e default sync
```

**Set them on every `sync`.** Helmfile doesn't keep earlier values, so a `sync` without them removes them from the Secret. To avoid repeating them, use `XANA_EXISTING_SECRET`.

Never commit a secret. Settings in `config` and `extraConfig` end up in a ConfigMap.

### Ingress

The Ingress sends everything to the frontend, which forwards `/api`, `/ws` and `/api/ngsi/ws` to the backend. Agent calls can take 300 seconds, and uploads can reach 64 MB, so the Ingress controller must allow both:

- **nginx:** `ingressClass: nginx` sets the annotations for this.
- **Traefik**, the platform's default: `ingressClass: traefik`. Traefik has no body limit or short read timeout by default. Add any middleware through `ingress.annotations`.

## Limits

- The backend runs as one replica, because runs and their streams are held in the process. An upgrade restarts it, and stored runs continue afterwards.

## Images

To deploy to your own cluster, build the images and push them to your registry with `build.sh` at the repository root, then point an environment at them:

```bash
docker login <registry>                       # if the registry needs it
REGISTRY=<registry>/<path> IMAGE_TAG=1.2.3 ./build.sh
```

It pushes `<registry>/<path>/xana-ai-pdt-backend:1.2.3` and `<registry>/<path>/xana-ai-pdt-frontend:1.2.3`, the names the chart renders from `imageRegistry: <registry>/<path>` and `imageTag: "1.2.3"` in your environment file.

- `REGISTRY` defaults to `k3d-iff.localhost:12345` and `IMAGE_TAG` to `latest`. `REGISTRY` is a registry and optional path, `host[:port][/path…]`, with no spaces and lower-case path parts; a value that isn't stops the script before building, naming where it came from. To keep yours, copy `build.conf.example` to `build.conf` (git-ignored); shell variables win over it. It is read as `KEY=VALUE` lines for those two keys only, not run.
- `./build.sh backend` or `./build.sh frontend` builds one image; `--no-push` builds without pushing; `--help` shows the usage. It prints the registry, tag and names first, builds every selected image before pushing any, and stops at the first failure, saying what failed.
- A registry served over plain HTTP under another name than `localhost`, such as k3d's, has to be listed in Docker's `insecure-registries` first.

CI builds both images with `./build.sh --no-push` on every related Pull Request. Publishing to `ghcr.io/industryfusion` happens only from a version tag.

## Trying it on a local cluster

`test/` has stand-ins for the platform's services, and the `Deployment` workflow installs this way on every related Pull Request. With [kind](https://kind.sigs.k8s.io/):

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
(cd helm && helmfile -e local sync)
python helm/test/smoke.py http://127.0.0.1 run --host xana.localhost
```

The stand-in database trusts every connection. Use this on a local cluster only.
