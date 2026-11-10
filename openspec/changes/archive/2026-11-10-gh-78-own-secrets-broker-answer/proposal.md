# Proposal

Issue: #78

## Why

- **XANA's own Secret is read from the wrong namespace.** Since #75, a `secretLookups` entry without its own `namespace` is read from `platformNamespace` (`iff`). That includes XANA's own Secret `xana-pdt-credentials`. `envs/iff-cluster.sh` reads it from `IFF_NAMESPACE` too. An operator who creates it in `xana-pdt`, next to XANA, gets nothing.
- **The broker check hides the cause.** It calls `GET /ngsi-ld/v1/types` and reports only "refused the token (HTTP …)" or "answered HTTP …", dropping the body Scorpio sends back, which says why. An operator whose pgrest and Alerta accept the same token can't tell what is wrong.

## What Changes

- **Each lookup names its namespace.** A `secretLookups` entry's `namespace` may be a namespace's name, or `$namespace` (the release's, default `xana-pdt`) or `$platformNamespace` (default `iff`). `default.yaml` writes one on every entry, with a comment saying whether the Secret is XANA's own or the platform's:
  - XANA's own, `$namespace`: `xana-pdt-credentials`, for `EVENT_WEBHOOK_SECRET`, `SETTINGS_ENCRYPTION_KEY`, `GATEWAY_CLIENT_SECRET`, the model keys and the Langfuse keys.
  - The platform's, `$platformNamespace`: `alerta`, and the Keycloak client Secret in the commented example.
  - An entry without `namespace` is still read from `platformNamespace`, as now.
- **`databaseCredentialsNamespace`:** a new key, default `$platformNamespace`, for the database operator's Secret, or a copy of it kept in `xana-pdt`.
- **`envs/iff-cluster.sh`:** reads `xana-pdt-credentials` from a new `XANA_NAMESPACE` (default `xana-pdt`), and the platform's Secrets from `IFF_NAMESPACE` (default `iff`), as now.
- **The broker health check:**
  - sends `Accept: application/ld+json`;
  - on any answer but 200, reports the HTTP status, the masked address it called, whether a token was sent, and the start of Scorpio's answer (its `title` and `detail`, or else its first 300 characters), with secrets masked;
  - keeps its words "refused the token" for 401 and 403, and "answered HTTP …" otherwise;
  - its hint names the usual causes in order: nobody signed in, `keycloakUrl` not the issuer Scorpio checks, no role on client `scorpio`, and `ngsiTenant`.
- **Docs:** the README, the comments in Section 3 of `default.yaml`, and the header of `envs/iff-cluster.sh` say which Secret is in which namespace.
- **Testing:** none added or run, and CI isn't waited for, at the maintainer's request.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `deployment/kubernetes`: the namespace of each lookup, `databaseCredentialsNamespace`, and the helper's `XANA_NAMESPACE`.
- `backend/service-runtime`: what the broker check reports.

## Impact

- `helm/environment/default.yaml`, `values.yaml.gotmpl`, the chart's lookup helper and `values.yaml`, `helm/envs/iff-cluster.sh`, `helm/test/local-values.sh` (its entries' namespaces), `helm/README.md`.
- `backend/app/health.py`: `_broker` and the broker hint.
- No change to the frontend.

## Out of Scope

- RAG (#18).
- Another Scorpio endpoint for the check.
- New tests, test runs, a local cluster run, and waiting for CI, as the maintainer decided.
