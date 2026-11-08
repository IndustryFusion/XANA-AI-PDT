# Design

## Context

`helm/helmfile.yaml.gotmpl` defines environments as ordered lists of value files: `production` is `default.yaml` then `production.yaml`, and `local` is `default.yaml` then `local.yaml`. Helmfile merges the files in order, so a later file wins for a key it sets. The chart and `values.yaml.gotmpl` read the keys of `default.yaml`. There is no conflict with `architecture.md` or the specs.

## Decisions

### Layering

`localAndIonos` is `default.yaml`, `production.yaml`, `localAndIonos.yaml`, as the issue sets out: it is production with that cluster's differences.

### Which keys the file sets

Only keys that a cluster of this kind is expected to set differently from production, all keys `default.yaml` already has:

| Group | Keys |
|---|---|
| Images | `imageRegistry`, `imageTag` |
| Ingress | `ingressClass`, `ingressHost`, `ingressTlsSecret` |
| Platform services | `keycloakUrl`, `ngsiUrl`, `pgrestUrl`, `alertaUrl`, `fusekiUrl`, `mqttBrokerUrl`, `databaseHost` |
| Dataspace | `gatewayUrl`, `gatewayKeycloakUrl`, `ifricUrl` |

The rest is inherited. A key not listed here can be added to the file later in the same way.

### Placeholders, open for the maintainer

**Open:** the real values for the local-and-IONOS cluster are not known here. Each value in the file is a placeholder under the reserved `.invalid` domain (for example `replace-me.invalid` for a host, `https://keycloak.replace-me.invalid/auth` for an address, `replace-me` for a tag or Secret name), with a comment naming what goes there. `.invalid` can't resolve, so a deployment with a placeholder left in fails visibly instead of reaching another host. The README lists every placeholder an operator must replace. The maintainer is asked to supply the values, or to confirm that operators fill them in per cluster.

Alternatives considered:

| Option | Why not |
|---|---|
| Leave the keys out until the values are known | The environment would be production under another name, and nothing would show what has to be set |
| Fail the render while a placeholder is left | CI renders the environment as committed, so it would always fail; a deployment fails anyway on an `.invalid` address |

### No secrets

The file holds no secret, and no key in it names one. CI's secret check, which renders an environment with a secret from the shell and finds it only in the Secret, runs for `localAndIonos` too.

### Checking the layering

CI renders `localAndIonos` and checks that a value it sets (for example `imageTag`) is the one in the rendered Deployment, not production's or default's, and that a value it doesn't set is production's (`imagePullPolicy`).

## Risks

- Until the values are filled in, the environment renders but can't run. That is intended, and the README says so.
