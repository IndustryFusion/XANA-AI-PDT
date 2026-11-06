# Proposal

Issue: #20

## Why

`architecture.md` describes a Kubernetes deployment next to the digital twin platform, but the repository has no frontend image, no chart and no way to run in a cluster. The later connection issues need a deployment to add their settings to.

## What Changes

- Add a frontend image with nginx serving the UI, and proxying `/api`, `/ws` and `/api/ngsi/ws` to the backend.
- Make the backend image production-ready, and add a liveness route for probes.
- Add a Helm chart and Helmfile: Deployments, Services, ConfigMaps, Ingress, probes, resources, and secrets from three sources.
- Add `POSTGRES_SSLMODE` and `POSTGRES_SSLROOTCERT` settings for database TLS.
- Build images and check the chart in CI.
- Document the install, and correct the deployment section of `architecture.md`.

## Capabilities

### New Capabilities

- `deployment/kubernetes`: How XANA AI PDT is built into images, installed on a cluster running the platform, and given its configuration and secrets.

### Modified Capabilities

- `backend/service-runtime`: Database TLS settings and a liveness route.

## Impact

- New: `frontend/Dockerfile`, `frontend/nginx/`, `helm/`, `.github/workflows/deployment.yml`.
- Changed: `backend/Dockerfile`, `backend/app/config.py`, `backend/app/main.py`, `backend/.env.example`, `backend/README.md`, `frontend/README.md`.
- `architecture.md`: Deployment Architecture.
- The platform's PostgreSQL chart already declares the `memory` database, so the platform needs no change.

## Out of Scope

- Settings for connections that don't exist yet. Each later issue adds its own settings.
- Changes to the digital twin platform.
- Publishing images on every merge. Images are published only from version tags.
- Running more than one backend replica, as runs are held in the process.
