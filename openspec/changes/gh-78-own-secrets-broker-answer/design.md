# Design

## Context

Since #75, the chart reads secrets not given in the shell or the file with Helm `lookup` when deploying: the database operator's Secret (`databaseCredentialsSecret`) and each `secretLookups` entry, in the entry's `namespace` or else `platformNamespace` (`iff`). Every default entry lacks a `namespace`, so XANA's own `xana-pdt-credentials` is read from `iff`. `envs/iff-cluster.sh` reads every Secret, `xana-pdt-credentials` included, from `IFF_NAMESPACE`.

The broker check in `backend/app/health.py` sends `Accept: application/json`, and on a non-200 answer reports only the status.

This change modifies the `deployment/kubernetes` requirements "Platform namespace", "Platform Secrets read when deploying" and "Cluster secrets helper", and adds one to `backend/service-runtime`. There is no conflict with `architecture.md`.

## Decisions

### Which Secret is read where

| Secret | Kind | Read in |
|---|---|---|
| `xana-pdt-credentials` (`EVENT_WEBHOOK_SECRET`, `SETTINGS_ENCRYPTION_KEY`, `GATEWAY_CLIENT_SECRET`, `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `LANGFUSE_PUBLIC_KEY`, `LANGFUSE_SECRET_KEY`) | XANA's own | `namespace` (default `xana-pdt`) |
| `alerta` (`ALERTA_API_KEY`) | the platform's | `platformNamespace` (default `iff`) |
| `keycloak-client-secret-xana` (`KEYCLOAK_SERVICE_CLIENT_SECRET`, the commented example) | the platform's | `platformNamespace` |
| the database operator's Secret (`databaseCredentialsSecret`) | the platform's | `databaseCredentialsNamespace` (default `platformNamespace`) |

### An entry's namespace, written out

Each entry in `default.yaml` gets a `namespace`, with a comment above the group saying whether its Secrets are XANA's own or the platform's:

```yaml
secretLookups:
  # The platform's Secrets, in platformNamespace (iff):
  - { variable: ALERTA_API_KEY, secret: alerta, key: alerta-admin-key, namespace: $platformNamespace }
  # XANA's own Secret, in namespace (xana-pdt). Create it there (see README.md):
  - { variable: EVENT_WEBHOOK_SECRET, secret: xana-pdt-credentials, key: EVENT_WEBHOOK_SECRET, namespace: $namespace }
  …
```

`namespace` takes a namespace's name, or `$namespace` for the release's, or `$platformNamespace`. Writing `xana-pdt` and `iff` literally would also be explicit, but then changing `namespace` or `platformNamespace` would no longer move these lookups, which the issue's acceptance criteria ask for. Kubernetes names can't contain `$`, so the two references can't clash with a real namespace. The chart resolves them, so a plain `helm` install behaves the same: `$namespace` is `.Release.Namespace`. Any other value is used as given, so an entry's own namespace still wins. An entry without `namespace` is still read from `platformNamespace`, so an operator's own entries keep working.

A `$` name the chart doesn't know (for example a typo, `$namespcae`) stops the render, naming it.

### `databaseCredentialsNamespace`

A new key in Section 3, next to `databaseCredentialsSecret`, default `$platformNamespace`, taking the same values. An operator who keeps a copy of the operator's Secret in `xana-pdt` sets `$namespace`. The messages that name where the credentials were read, and the offline note, name this namespace.

### `envs/iff-cluster.sh`

- `XANA_NAMESPACE` (default `xana-pdt`) is where it reads `xana-pdt-credentials`; `IFF_NAMESPACE` (default `iff`) stays for `alerta`, the Keycloak client Secret and the database operator's Secret.
- It prints both namespaces with the kube context. The check that Secrets can be read is made per namespace: a namespace it can't read reports its variables as not found, and only when neither can be read does the source fail with status 1, as now when `iff` can't be read.
- `XANA_NAMESPACE` is not one of the old `XANA_*` variables the render refuses, so exporting it doesn't stop `helmfile`.

### The broker check

- It sends `Accept: application/ld+json`, as the platform's own clients do, with the token and `NGSILD-Tenant` as now.
- On any status but 200, the detail is: `<address> refused the token (HTTP <status>; <a token was sent | no token was sent>). Scorpio said: <answer>` for 401 and 403, and `<address> answered HTTP <status> (…). Scorpio said: <answer>` otherwise, where:
  - `<address>` is `…/ngsi-ld/v1/types`, masked with `mask_url`;
  - `<answer>` is the JSON answer's `title` and `detail` (NGSI-LD's problem details), joined by ": ", else the first 300 characters of the body with runs of whitespace made one space, else "nothing";
  - the token, if one was sent, is replaced by `***` in the answer, and the detail then goes through the report's redactor, which masks every configured secret, as for every check.
- The words "refused the token" and "answered HTTP" stay, so existing readers of the detail keep working.
- The broker hint becomes: "Check, in order: that someone is signed in (the check uses the operator's token); that KEYCLOAK_URL is the issuer Scorpio checks, Keycloak's external address; that the user has a role on client scorpio; and that NGSI_TENANT, if set, names a tenant that exists."

### Docs

- `default.yaml`: Section 3's comments for each secret say where its default lookup reads it; the lookups block comments name both kinds.
- `envs/iff-cluster.sh`: the header lists which Secret it reads from which namespace.
- `helm/README.md`: the table of Secrets and namespaces, creating `xana-pdt-credentials` in `xana-pdt`, `databaseCredentialsNamespace`, `XANA_NAMESPACE`, and the broker check's detail and hint.

### Testing

At the maintainer's request, no tests are added or run, no local cluster is used, and CI isn't waited for. The existing tests that read the broker detail look for "refused" and the status, which stay.

## Risks

- **An operator who already created `xana-pdt-credentials` in `iff`** gets nothing from it after this change: move it to `xana-pdt`, or set those entries' `namespace` to `$platformNamespace`. The README says so.
- **Scorpio's answer could echo something sensitive.** The token is masked, the configured secrets are masked by the redactor, and the answer is cut to 300 characters.
- **Untested:** the `$` references, `XANA_NAMESPACE` and the new detail are changed without new tests, as decided.
