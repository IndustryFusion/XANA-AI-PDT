# Design

## Context

The backend has a Dockerfile used by the local environment. The frontend runs only through the Vite server. The platform (IndustryFusion/DigitalTwin) provides PostgreSQL through its operator, including a `memory` database and generated credentials in the Secret `ngb.acid-cluster.credentials`, along with Scorpio and TimescaleDB, in namespace `iff`.

## Goals / Non-Goals

**Goals:**

- A documented install of one release into its own namespace, next to the platform.
- No secrets or environment-specific hosts in the repository.

**Non-Goals:**

- Installing the platform itself.

## Decisions

**One Ingress path to the frontend, which proxies to the backend.** The frontend's nginx handles `/api`, `/ws` and `/api/ngsi/ws`, so the image works the same with or without an Ingress, and the UI needs no separate backend address. Alternative: Ingress paths to each Service, which needs the same routing written twice, and doesn't work without an Ingress.

**The backend address comes from an environment variable at container start.** The nginx image renders its template with `XANA_BACKEND_URL`. Alternative: a ConfigMap holding the full nginx configuration, which puts application routing in the chart.

**An unprivileged nginx image.** It listens on 8080 and runs without root, which fits restricted clusters. Alternative: the standard image, which needs root to start.

**One backend image.** The local environment uses the same image with its own command and mounts. Alternative: separate development and production images, which would need a reason to differ, and there isn't one.

**Secrets in order of preference.** `secrets.existingSecret` supplies everything from one Secret. Otherwise, `database.credentialsSecret` supplies the database user and password from the operator's generated Secret, and the chart builds the two database URLs from them, with Kubernetes variable expansion. `secrets.values` covers install-time values, for anything else. Alternative: only an existing Secret, which makes a platform install need an extra manual step when the operator already provides credentials.

**The operator's Secret must be in the same namespace.** A Pod can only read Secrets in its own namespace. The default install therefore uses namespace `iff`, next to the platform's credentials. An install in another namespace uses `secrets.existingSecret`. Alternative: `xana-ai-pdt` as `architecture.md` says, which needs the credentials to be copied by hand. The chart reports the namespace in its install notes.

**TLS settings apply to both database URLs in configuration.** `POSTGRES_SSLMODE` and `POSTGRES_SSLROOTCERT` are added to the URLs when they don't already state them, in one place, so all connections follow. Alternative: passing them at each connection, which means several places to change.

**A liveness route, `/healthz`, for both probes.** The backend starts without its dependencies by design, so `/api/diagnostics` would tie a Pod's life to other services and run real checks on each probe. Alternative: `/api/diagnostics`, for the same reasons rejected.

**Publishing only from version tags.** Pull requests and merges build the images. A `v*` tag publishes them to the GitHub Container Registry. Alternative: publishing on every merge, which creates public images nobody chose to release.

**One backend replica.** Runs and their streams live in the process. The chart fixes it at one replica, and the strategy is `Recreate`. Alternative: an option for more replicas, which wouldn't work.

## Architectural implications

`architecture.md` names namespace `xana-ai-pdt`, and a ConfigMap for nginx. Both change here, and the section is corrected. The chart's name stays `xana-pdt`, and the Helmfile layout follows the description already there, without the retrieval release.

## Risks / Trade-offs

- [Full platform install can't run in CI or on every machine] → The chart is checked on a local cluster with stand-in services, and the check on a real platform is reported separately.
- [Password characters in a URL] → Operator-generated passwords are alphanumeric. Other credentials can use `secrets.existingSecret`, with fully encoded URLs.
- [`nginx` Ingress annotations don't apply to Traefik] → `ingress.annotations` is a value, and the README states what to set for each.

## Open Questions

None.
