# Proposal

Issue: #72

## Why

The chart assumes it runs in `iff`, next to the digital twin platform. The platform's addresses are short Service names that resolve only inside `iff`. The backend builds its database URLs from the database operator's Secret with `secretKeyRef`, and a Pod can read Secrets only in its own namespace. So XANA can't be installed in a namespace of its own: the backend doesn't start, and it couldn't reach the platform if it did.

## What Changes

- **Namespace:** `namespace` defaults to `xana-pdt` in all three environments. A new key, `platformNamespace` (default `iff`), names where the platform runs.
- **Platform addresses:** the default addresses of the platform's services name `platformNamespace`, for example `http://scorpio-all-in-one-runner.iff:9090`, for Scorpio, pgrest, Alerta, Fuseki, the two EMQX addresses and the database host. An address set in an environment file is used as given.
- **Database credentials:** the backend gets them without reading a Secret in another namespace.
  - `envs/iff-cluster.sh` reads them from the operator's Secret in the platform's namespace and exports them as `DATABASE_USERNAME` and `DATABASE_PASSWORD`.
  - The chart stores them, percent-encoded, in a Secret of its own, and the Pod builds both database URLs from it as today.
  - Without them, `databaseCredentialsSecret` names a Secret the operator copied into `xana-pdt`.
  - With neither, and without both database URLs, the render stops, naming the options.
  - A password changed on the platform reaches XANA by sourcing the helper again and applying again.
- **`envs/iff-cluster.sh`:** still reads from `IFF_NAMESPACE` (default `iff`); it also exports the database credentials, and says when a variable it keeps differs from the cluster's value, without showing either.
- **Other Secrets:** `secretLookups` and `databaseCaSecret` still name Secrets in `xana-pdt`; the README says how to copy one there.
- **Machine events:** the `callbackBaseUrl` example becomes `http://xana-pdt-backend.xana-pdt:8000`.
- **Network policies:** the README notes that a NetworkPolicy in `iff` admitting only its own namespace must also admit `xana-pdt`, both ways for machine events.
- **Local test cluster:** XANA in `xana-pdt`, the stand-ins in `iff`. The smoke test checks that the backend starts, reaches the stand-ins and connects to the database.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `deployment/kubernetes`: the release's namespace, the platform's addresses, the database credentials, the cluster-secrets helper and the local test cluster.

## Impact

- `helm/`:
  - `environment/{default,production,localAndIonos}.yaml` and `values.yaml.gotmpl`: `namespace`, `platformNamespace`, the default addresses, the database credential keys.
  - The chart: a database credentials Secret, the backend Deployment's `secretKeyRef`, the render check, `NOTES.txt`.
  - `envs/iff-cluster.sh`.
  - `test/`: `check_render.py`, `check_values.py`, `check_environments.py` where needed, `iff_cluster_test.sh`, `local-values.sh`, the stand-ins, and `README.md`.
- `.github/workflows/deployment.yml`: the namespaces of the local test cluster and its checks.
- `architecture.md`: the deployment section's namespace.
- No change to the backend or frontend code or images.

## Out of Scope

- RAG (#18).
- Changes to the platform or its database operator, such as Secrets shared across namespaces.
- Installing on a real cluster.
