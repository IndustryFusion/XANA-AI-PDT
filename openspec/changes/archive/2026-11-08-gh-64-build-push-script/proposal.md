# Proposal

Issue: #64

## Why

CI publishes the images only to `ghcr.io/industryfusion/`, and only from a `v*` tag. An operator who deploys to their own cluster, for example one with a local registry, has no supported way to put the images where the chart's `imageRegistry` and `imageTag` point.

## What Changes

- `build.sh` at the repository root builds `xana-ai-pdt-backend` and `xana-ai-pdt-frontend` and pushes them as `<REGISTRY>/<name>:<IMAGE_TAG>`, the names the chart renders from `imageRegistry` and `imageTag`.
- `REGISTRY` defaults to `k3d-iff.localhost:12345`, `IMAGE_TAG` to `latest`. Values come from the shell first, then from an optional, git-ignored `build.conf` next to the script; `build.conf.example` is committed and shows the keys.
- Both images by default; `backend` or `frontend` selects one; `--no-push` builds without pushing; `--help` shows the usage.
- It prints the registry, the tag and each image name before it starts, and stops at the first failure, saying what failed, with a non-zero exit.
- CI runs `./build.sh --no-push` and shellcheck.
- `helm/README.md` explains building, pushing and pointing an environment at the images.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `deployment/kubernetes`: a build-and-push script for an operator's own registry.

## Impact

- New: `build.sh`, `build.conf.example`; `.gitignore` gains `build.conf`.
- `.github/workflows/deployment.yml`: a step that runs the script in build-only mode, and shellcheck.
- `helm/README.md`.
- `architecture.md`: the deployment section mentions the script.
- No change to the images, the chart or CI's publishing.

## Out of Scope

- Changing how CI publishes to GHCR.
- Logging in to a registry: the operator does that with `docker login` first.
- Images for other architectures than the building machine's.
- RAG images (#18).
