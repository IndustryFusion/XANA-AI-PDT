# Tasks

Testing for this change is offline, as the maintainer decided: `helm template` and `helmfile template` with `KUBECONFIG=/dev/null`, the unit checks, shellcheck, and CI. No run on a local cluster is planned.

## 1. Environments and `default.yaml`

- [x] 1.1 `default.yaml` in the three sections of the design, with the platform's addresses written out as `<service>.iff.svc.cluster.local` and `callbackBaseUrl`; `production.yaml` with its three overrides; `localAndIonos.yaml` removed and `-e localAndIonos` stopping with the design's message; verify both environments render offline
- [x] 1.2 `values.yaml.gotmpl` without the address derivation; `platformNamespace` passed for lookups; `LANGFUSE_HOST` and `LANGFUSE_BASE_URL` from the shell; the chart's `values.yaml` with the full addresses
- [x] 1.3 `check_values.py`: the sections, the key placement, the `Example:`/`If empty:` and `For:`/`Required:`/`Get:` lines, `.svc.cluster.local` addresses, the committed-file check allowing `.svc.cluster.local`; `check_environments.py` for `production` and the removed environment; verify each fails when undone

## 2. Secrets read when deploying

- [x] 2.1 The chart's lookup helper: the database credentials from `databaseCredentialsSecret` in `platformNamespace`, `secretLookups` with `namespace`, copied into the chart's Secrets; no Pod-time `secretKeyRef` for lookups; the offline detection and note; the default `secretLookups`
- [x] 2.2 `check_render.py`: shell, file and test lookup data in that order; nothing found stops with a cluster and doesn't without; the offline note; special characters from a lookup; verify each fails when undone

## 3. Checked when deploying

- [x] 3.1 The paired and value checks of the design, with the backend's messages and hints, skipped offline for a value a lookup could give
- [x] 3.2 `check_render.py` for each check, and a check that each message is word for word in `backend/app/config.py`; verify each fails when undone

## 4. CI

- [ ] 4.1 CI: render `default` and `production`, `-e localAndIonos` stopping; the stand-ins with `EVENT_WEBHOOK_SECRET` in `xana-pdt-credentials` and the lookup test Secret; install without sourcing `envs/iff-cluster.sh`; verify on the Pull Request

## 5. Documents

- [x] 5.1 `helm/README.md`: the section table, the example env file, `set -a; source …; set +a`, the steps, the lookups and their RBAC, `template` and `diff` without a cluster, `LANGFUSE_BASE_URL`, and what changes for an install with the previous layout; `architecture.md`'s deployment section
