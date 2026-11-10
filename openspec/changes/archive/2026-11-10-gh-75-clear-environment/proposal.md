# Proposal

Issue: #75

## Why

An operator opening `helm/environment/default.yaml` can't see what is set for them, what they must set, and which secrets they must give:
- The platform's addresses are empty there and derived from `platformNamespace` when rendering, so the defaults can't be read in the file.
- `default.yaml` and `localAndIonos.yaml` cover different keys, and it isn't clear why `localAndIonos` exists.
- The secrets sit among the settings, and the newer ones don't say what they do, when they are needed, or how to make one.
- A missing secret that a setting needs, such as `SETTINGS_ENCRYPTION_KEY` with `gatewayUrl`, shows only when the backend Pod starts.
- The database login needs `envs/iff-cluster.sh` sourced first, or a Secret copied into `xana-pdt`.

## What Changes

- **Environments:** `default` and `production`. `localAndIonos` is removed, and `-e localAndIonos` stops with a message naming the two that remain. `production.yaml` keeps only its overrides: the image tag, the pull policy and the TLS Secret.
- **`default.yaml` in three sections**, each with a header comment, complete on its own:
  1. **Filled in for you:** the platform's in-cluster addresses written out in full (`http://scorpio-all-in-one-runner.iff.svc.cluster.local:9090`, the same form for pgrest, Alerta, Fuseki, EMQX and the database host), `callbackBaseUrl: http://xana-pdt-backend.xana-pdt.svc.cluster.local:8000`, the database names, realms, client ID, the images and the operational defaults.
  2. **Fill in for your cluster:** the Ingress, Keycloak's external address, the language model, the dataspace, IFRIC and the other external addresses. Each says what it is, gives an example, and says what happens when it is left empty.
  3. **Secrets:** every secret, empty, with its shell variable, what it is for, when it is required, and how to get or generate it; then where the chart reads platform Secrets.
- **No derivation:** the addresses are no longer derived from `platformNamespace`. The key stays, as the namespace the chart reads platform Secrets from.
- **Platform Secrets read when deploying:** a secret or the database credentials not given in the shell or the file are read with Helm `lookup` during `apply` from the platform's Secrets: the database operator's Secret, and `secretLookups` entries, which gain a `namespace`. The chart copies them into its own Secrets in `xana-pdt`. `envs/iff-cluster.sh` is no longer needed, and still works.
- **Without a cluster** (`helmfile template`, or a `diff` without cluster access), the lookups are skipped and the rendered Secrets say so; nothing then stops that `apply` would pass.
- **Checked when deploying:** the render stops with the backend's own message for each pair the backend enforces, for example `SETTINGS_ENCRYPTION_KEY` with `gatewayUrl`, with the command that makes one.
- **Secrets from an env file:** `set -a; source my-secrets.env; set +a`, then `apply`. The README has an example file with every name. `LANGFUSE_BASE_URL` is accepted as well as `LANGFUSE_HOST`.
- **README:** a table of the three sections, the example env file, the steps, and what changes for an install made with the previous layout.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `deployment/kubernetes`: the environments, the layout of `default.yaml`, the platform's addresses, where secrets and the database credentials come from, the checks made when deploying, and the README.

## Impact

- `helm/environment/default.yaml` and `production.yaml`; `environment/localAndIonos.yaml` removed.
- `helm/helmfile.yaml.gotmpl` and `values.yaml.gotmpl`.
- The chart: the backend and database Secrets (deploy-time lookups), the backend Deployment (no Pod-time `secretKeyRef` for lookups), the paired checks, `NOTES.txt`, `values.yaml`.
- `helm/test/`: `check_values.py`, `check_render.py`, `check_environments.py`, `local-values.sh`, the stand-ins; `helm/README.md`; `architecture.md`'s deployment section.
- `.github/workflows/deployment.yml`: the environments, and the install without sourcing the helper.
- No change to the backend or frontend code or images.

## Out of Scope

- RAG (#18).
- Backend behaviour, other than the chart checking a setting earlier.
- Installing on a real cluster.
- A full run on a local cluster before review: the maintainer asked for offline renders, the unit checks and CI only.
