# Proposal

Issue: #65

## Why

The Helm setup has the environments `default`, `production` and `local`. A deployment on a local-and-IONOS cluster needs its own settings on top of production, and has no environment.

## What Changes

- `helm/environment/localAndIonos.yaml`, added to `helm/helmfile.yaml.gotmpl` as the environment `localAndIonos`, layered `default.yaml`, then `production.yaml`, then `localAndIonos.yaml`. A later file overrides an earlier one.
- The file holds only settings that differ from production for that cluster: the image registry and tag, the Ingress class, host and TLS Secret, and the platform service addresses. The maintainer hasn't given the values, so each is a clearly marked placeholder under the reserved `.invalid` domain, such as `https://keycloak.replace-me.invalid/auth`, with a comment saying what to put there.
- No secret is in the file. Secrets still come from `XANA_*` shell variables or `existingSecret`.
- CI renders the new environment, as it does the others, and runs the secret check on it too. A check that `localAndIonos.yaml` wins over `production.yaml` and `default.yaml` for a value set in each.
- `helm/README.md` lists the environment, its layering and the values an operator must fill in.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `deployment/kubernetes`: the `localAndIonos` environment.

## Impact

- `helm/helmfile.yaml.gotmpl`, new `helm/environment/localAndIonos.yaml`, `helm/README.md`.
- `.github/workflows/deployment.yml`: the environment in the render loop and the secret check, and a check of the layering.
- `architecture.md`: the list of environments, if it names them.
- No change to the chart's templates or to the other environments.

## Out of Scope

- The real values for that cluster: open for the maintainer (see `design.md`).
- Installing on a real cluster.
- RAG settings (#18).
