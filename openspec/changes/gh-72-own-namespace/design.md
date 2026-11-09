# Design

## Context

`deployment/kubernetes` installs XANA in `iff`, the platform's namespace (`namespace: iff` in `environment/default.yaml`). The default addresses are short Service names (`scorpio-all-in-one-runner`, `pgrest`, `alerta`, `fuseki`, `emqx-listeners`, `emqx-dashboard`, `acid-cluster`), which resolve only from inside `iff`. Unless both database URLs are given, the Pod builds them from `databaseCredentialsSecret` (default `ngb.acid-cluster.credentials`, the database operator's Secret) with `secretKeyRef`, which can only name a Secret in the Pod's own namespace.

This change moves XANA to `xana-pdt`, as #72 sets out. It modifies the requirements "Installable chart" (its default addresses), "Backend secrets" (the database credentials), "Cluster secrets helper" and "Local test cluster on the default environment", and adds two. There is no conflict with `architecture.md`, whose deployment section is updated to name the namespace.

## Decisions

### Namespaces

- `namespace` defaults to `xana-pdt` in `default.yaml`; `production` and `localAndIonos` inherit it.
- A new key, `platformNamespace` (default `iff`), names the namespace the platform runs in. It is used for the default addresses below, and by nothing else in the chart.
- An operator who wants XANA next to the platform sets `namespace: iff`. Then `databaseCredentialsSecret: ngb.acid-cluster.credentials` works as before (see below).

An existing release in `iff` isn't moved: `apply` installs a new one in `xana-pdt`. The README says to remove the old one with `helm -n iff uninstall xana-pdt`; the data is in the platform's database and is kept.

### Default platform addresses

In `default.yaml` the platform's address keys are empty, and `values.yaml.gotmpl` fills an empty one from `platformNamespace`:

| Key | Default, with `platformNamespace: iff` |
|---|---|
| `ngsiUrl` | `http://scorpio-all-in-one-runner.iff:9090` |
| `pgrestUrl` | `http://pgrest.iff:3000` |
| `alertaUrl` | `http://alerta.iff:8080/api` |
| `fusekiUrl` | `http://fuseki.iff:3030` |
| `mqttBrokerUrl` | `mqtt://emqx-listeners.iff:1883` |
| `mqttMgmtUrl` | `http://emqx-dashboard.iff:18083` |
| `databaseHost` | `acid-cluster.iff` |

- `<service>.<namespace>` resolves from any namespace through the cluster's DNS search path (`svc.cluster.local`).
- An address set in an environment file, or a state values file, is used as given; `localAndIonos.yaml` sets all of them already.
- Empty means "the platform's default" for these keys only. They can't be turned off, as today: the backend has its own defaults for each.

Alternative: keep the full addresses in `default.yaml`. Then changing `platformNamespace` wouldn't change them, which the issue asks for. Environment files as templates can't see a later file's `platformNamespace` either.

### Database credentials

The backend still reads only `TIMESCALE_DB_URL` and `POSTGRES_MEMORY_URL`. Unless both are given as secrets, the Pod builds them as today, `postgresql://$(DB_USER):$(DB_PASSWORD)@<host>:<port>/<database>`, with `DB_USER` and `DB_PASSWORD` from `secretKeyRef`. What changes is which Secret, all in the release's namespace, in this order:

1. **Credentials given to the chart.** Two new secret keys, `databaseUsername` and `databasePassword`, empty in every committed file. The shell variables `DATABASE_USERNAME` and `DATABASE_PASSWORD` win over them, as for the other secrets. `envs/iff-cluster.sh` exports both. With both set, the chart creates the Secret `<release>-database` (`xana-pdt-database`) with keys `username` and `password`, and `DB_USER` and `DB_PASSWORD` read from it. They are not put in the backend's Secret, which is loaded whole with `envFrom`.
2. **A copied Secret.** Without them, `databaseCredentialsSecret` names a Secret in the release's namespace with keys `username` and `password`, which the operator copied there. Its default becomes empty, as the operator's Secret isn't in `xana-pdt`.
3. **Neither**, and not both URLs given: the render stops with: "The backend has no database credentials in namespace xana-pdt. Source envs/iff-cluster.sh, or set DATABASE_USERNAME and DATABASE_PASSWORD; or set databaseCredentialsSecret to a Secret copied into xana-pdt; or give TIMESCALE_DB_URL and POSTGRES_MEMORY_URL." Only one of the two credentials set stops it as well, naming the other.

The stop is in the chart, so `helm template` without Helmfile behaves the same. The render checks in CI give test credentials.

The chart's Secret's checksum is an annotation on the backend Deployment, so a changed credential restarts the backend.

**Special characters.** The URL is built by Kubernetes from the two values, so the values have to be valid in the URL's user-info part. The chart percent-encodes both when it stores them: `urlquery`, which encodes every byte except letters, digits, `-`, `_`, `.` and `~`, then `+` replaced with `%20`, since `urlquery` writes a space as `+` and a literal `+` as `%2B`. PostgreSQL decodes percent-encoding in a URL, so the password reaches it unchanged. The encoded values hold no `$`, so Kubernetes' `$(…)` expansion can't change them. A copied Secret (option 2) is used as it is, as today: its values must not need encoding, which holds for the operator's generated passwords; the README says so.

Alternative: the chart builds both URLs and puts them in its Secret. That works for option 1, but a copied Secret (option 2) still needs the Pod to build them; building them in the Pod in both cases keeps one way.

Alternative: `PGPASSWORD`-style variables read by the backend. That needs a backend change, which the issue doesn't ask for.

### `envs/iff-cluster.sh`

- Still reads from `IFF_NAMESPACE` (default `iff`).
- Also exports `DATABASE_USERNAME` and `DATABASE_PASSWORD` from the operator's Secret, `IFF_DATABASE_SECRET` (default `ngb.acid-cluster.credentials`), keys `username` and `password`, by the same rules as the other variables: a set, non-empty variable is kept, a missing Secret or key is reported by name, and no value is printed or written.
- New for every variable: when it keeps a set value that differs from the cluster's, it says so ("already set, kept; differs from Secret …"), comparing in memory without printing either value. That makes a stale password visible.

`xana-pdt-credentials` is still read from `IFF_NAMESPACE`, as the issue says. **For the maintainer:** it is XANA's own Secret, so it could move to `xana-pdt` later; this change leaves it.

### A password change on the platform

When the operator's Secret in `iff` gets a new password, XANA's copy in `xana-pdt-database` is stale. New database connections fail, and the System screen and `/api/diagnostics` show the database as failing. To bring it over:

1. In a new shell, or after `unset DATABASE_USERNAME DATABASE_PASSWORD`, `source envs/iff-cluster.sh`. In a shell that still holds the old values, the helper keeps them and reports that they differ.
2. `./helmfile -e <environment> apply`. The chart's Secret changes, so does the checksum on the backend Deployment, and the backend restarts with the new URLs.

With a copied Secret, copy it again, then `kubectl -n xana-pdt rollout restart deploy/xana-pdt-backend`; the chart doesn't own that Secret, so nothing restarts the backend by itself.

### Other Secrets

`secretLookups` and `databaseCaSecret` still name Secrets in `xana-pdt`. The README shows how to copy one from `iff`:

```bash
kubectl -n iff get secret <name> -o json \
  | jq 'del(.metadata.namespace, .metadata.uid, .metadata.resourceVersion, .metadata.creationTimestamp, .metadata.ownerReferences, .metadata.managedFields)' \
  | kubectl -n xana-pdt apply -f -
```

and that a copy doesn't follow later changes.

A check renders the default environment with test credentials and fails if any `secretKeyRef`, `envFrom` Secret or volume names a Secret the chart doesn't render itself. With `secretLookups` and `databaseCaSecret` set, only those are added.

### Machine events and network policies

- The `callbackBaseUrl` example becomes `http://xana-pdt-backend.xana-pdt:8000`, the backend as Scorpio in `iff` reaches it.
- The README notes that a NetworkPolicy in `iff` that admits only its own namespace has to admit `xana-pdt` too: from XANA to the platform's services, and, for machine events, from Scorpio to the backend.

### Local test cluster

- The stand-ins (database, Scorpio, their Secrets, the sample data, and the Secrets `envs/iff-cluster.sh` reads) stay in `iff`.
- XANA is installed into `xana-pdt` on the `default` environment with the generated values file, after `source envs/iff-cluster.sh`. The Secret for the `secretLookups` test moves to a manifest applied in `xana-pdt`.
- The stand-in operator Secret's password gets characters that need encoding (`@`, `:`, `/`, `%`, `+` and a space). The stand-in database trusts every connection, so this checks that the URL parses, not that the password is right; the render check checks the encoding.
- CI checks, on that cluster: the backend starts and is ready; its Deployment names no Secret it doesn't render; `TIMESCALE_DB_URL` and `POSTGRES_MEMORY_URL` name `acid-cluster.iff`; the `secretLookups` variable; the smoke test (a run reaches Scorpio's stand-in and is stored in the database, and is kept after a restart).

### Steps for an operator

1. Set the values in an environment file; `platformNamespace` if the platform isn't in `iff`.
2. `source envs/iff-cluster.sh` (it prints the kube context; check it).
3. `./bootstrap.sh`.
4. `./helmfile -e <environment> apply`.

## Risks

- **Stale password:** after a password change, XANA fails to connect until someone re-sources and re-applies. The helper's "differs" message and the health report make it visible.
- **Credentials pass through the operator's shell.** They are exported, as the other secrets already are, and stored in a Secret in `xana-pdt`, readable by whoever can read Secrets there. A copied Secret has the same exposure.
- **Existing installs in `iff`** get a second release in `xana-pdt` on the next `apply`, until the old one is removed. The README says so.
- **NetworkPolicies** in `iff` that admit only their own namespace block XANA, with connection errors in the health report.
