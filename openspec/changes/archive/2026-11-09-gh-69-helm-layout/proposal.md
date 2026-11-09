# Proposal

Issue: #69

## Why

XANA's `helm/` differs from the layout the IndustryFusion platform (DigitalTwin, Dataspace) uses. It has an extra `local` environment. Its settings are named differently: `image.registry`, a flat `config` map, an `existingSecret`, and `XANA_*` shell variables. It has neither a bootstrap script nor a helper for a cluster's secrets. An operator who knows the platform has to learn a second layout for XANA.

## What Changes

- **Layout:** `helm/bootstrap.sh`, `helmfile.yaml.gotmpl`, `values.yaml.gotmpl`, `envs/iff-cluster.sh`, `environment/{default,production,localAndIonos}.yaml`, and `charts/xana-pdt/`.
- **Environments:** exactly three. `default`; `production` is `default` then `production`; `localAndIonos` is `default`, `production`, then `localAndIonos`. `local` is removed.
- **Values handed to the chart:** `values.yaml.gotmpl` gives the chart:
  - `imageRegistry`, `imageTag`, `imagePullPolicy`
  - `backend.config`, the backend's settings as environment variables
  - `backend.secret`, each secret from an unprefixed shell variable of its own name, else from the environment file; the shell wins
  - `backend.postgresCredential`, the database URLs built at run time from the database operator's Secret
  - `backend.secretLookups`, other variables read at run time from named keys of Secrets in the cluster
  - `ingress.enabled`, `ingress.host`, `ingress.className`, `ingress.tlsSecret`
- **Environment keys:** camelCase, one for every setting the backend reads and none for any it doesn't. Settings the backend reads without a key today get one. `design.md` lists every key with the variable it sets.
- **`XANA_*` shell variables and `existingSecret` are replaced:**
  - The secrets use their own names (for example `ANTHROPIC_API_KEY`), and non-secret settings come only from environment files.
  - `secretLookups` takes over from `existingSecret`.
  - A render with an old `XANA_*` variable set fails, naming its replacement, so a secret isn't silently dropped.
- **Helper scripts:**
  - `bootstrap.sh` downloads a pinned, checksum-verified helmfile to `helm/helmfile` (git-ignored), and does nothing if that version is already there.
  - `envs/iff-cluster.sh`, sourced before `helmfile`, reads the backend's secrets from the cluster's Secrets with `kubectl` and exports them under their variable names. It writes nothing to disk, prints no secret, and keeps any variable already set.
- **Frontend proxy configuration:** the chart adds `frontend-configmap.yaml` with the frontend's nginx configuration, the same as the template built into the image, mounted over it.
- **Local test cluster:** `helm/test/` deploys `default` with a generated values file, which is not committed. CI renders the three environments and runs the smoke test as today.
- **Checks:** a check fails if a committed environment file holds a secret or a real host.
- **`build.sh` settings:** they move from `build.conf` to a git-ignored `.env` at the repository root, with the keys in a committed root `.env.example`; `build.conf` and `build.conf.example` are removed, as the maintainer decided.
- **Documents:** `helm/README.md` documents the layout, the environments, every key, the secrets and the steps. `build.sh`'s chart test and `check_render.py` follow the new value names.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `deployment/kubernetes`: the layout, the environments, the keys, the secret sources (replacing "Secrets from defined sources"), the bootstrap and cluster-secrets scripts, the frontend's proxy configuration, and the local test cluster.

## Impact

- `helm/`:
  - `values.yaml.gotmpl`, `helmfile.yaml.gotmpl` and all three environment files.
  - New `bootstrap.sh` and `envs/iff-cluster.sh`; `environment/local.yaml` is removed.
  - The chart's `values.yaml` and its backend Deployment, ConfigMap and Secret.
  - New `frontend-configmap.yaml`, and the frontend Deployment.
  - `test/` (`check_render.py`, `check_environments.py`, `build_test.sh`, the local cluster set-up), `README.md`.
- `.gitignore`: `helm/helmfile` and `.env`; `build.sh`, root `.env.example`, `build.conf.example` removed.
- `.github/workflows/deployment.yml`: the environment list, the local cluster with the `default` environment, and the checks.
- `architecture.md`: the deployment section.
- No change to the backend or frontend code or images.

## Out of Scope

- RAG, its chart, keys and secrets (#18).
- Installing on a real cluster.
- Real hosts and secrets in environment files.
- Keeping the old `XANA_*` variable names working.
