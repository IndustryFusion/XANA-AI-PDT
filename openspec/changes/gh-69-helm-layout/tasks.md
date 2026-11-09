# Tasks

## 1. Layout and values

- [x] 1.1 Rework `values.yaml.gotmpl`, the three environment files and `helmfile.yaml.gotmpl` with the design's keys, values and environments; remove `environment/local.yaml`; verify all three render
- [x] 1.2 Rework the chart's values, backend ConfigMap, Secret and Deployment for `backend.config`, `backend.secret`, `postgresCredential` and `secretLookups`; verify with `check_render.py`, updated
- [x] 1.3 Tests that each key reaches its variable, and that every key is in the table; verify each fails when a mapping is removed
- [x] 1.4 Tests that a secret from the file and from the shell reach the Secret, the shell winning, and never a ConfigMap; that an old `XANA_*` variable stops the render without showing its value; verify they fail without the change
- [x] 1.5 The check for secrets and real hosts in committed environment files; verify it fails for a secret value, a secret-like key and a real host

## 2. Scripts

- [x] 2.1 `bootstrap.sh` with the pinned version and checksums; git-ignore `helm/helmfile`; verify a run, a repeat that downloads nothing, a wrong checksum, and shellcheck
- [x] 2.2 `envs/iff-cluster.sh`; verify against the local test cluster: exported values, kept values, a missing Secret, no file written and no value printed; and shellcheck

## 3. Frontend

- [x] 3.1 `frontend-configmap.yaml`, mounted by the frontend, with its checksum on the Deployment; a check that it equals the image's template; verify the check fails when one changes

## 4. Local cluster and CI

- [x] 4.1 The local test cluster on `default` with a generated values file, and CI rendering the three environments; verify on the Pull Request
- [x] 4.2 On the local test cluster: `postgresCredential` and a `secretLookups` entry resolve from its Secrets, and the smoke test passes through the frontend's ConfigMap
- [x] 4.3 `build.sh`'s chart test with the new value names; verify it passes and still fails with a wrong image name

## 5. Build script settings

- [x] 5.1 `build.sh` reads `.env` at the root instead of `build.conf`; remove `build.conf.example`; add the keys to a new root `.env.example`; `.gitignore` covers `.env`; verify with `helm/test/build_test.sh`, updated, including that a `.env` line can't run, and shellcheck

## 6. Documents

- [x] 6.1 `helm/README.md`: the layout, the environments, every key, the secrets and the steps; `architecture.md`, and the build section for `.env`; verify against the design's tables

## 7. Review fixes

- [ ] 7.1 Stop the render for a `secretLookups` variable listed twice or set by the chart itself; NOTES list only the lookups used; verify with `check_render.py`, and that it fails without the stop
- [ ] 7.2 The committed-file check covers `imageRegistry` and every address key, with only `ghcr.io/industryfusion` exempt; the settings check reads `backend/app/config.py`; `ingressClass`, `existingSecret` and `extraConfig` in an environment file stop the render; verify each fails when undone
- [ ] 7.3 `envs/iff-cluster.sh`: returns its status, exports a variable set but not exported, refuses a shell other than bash, prints the kube context; verify with `iff_cluster_test.sh` on the local test cluster
- [ ] 7.4 `build.sh` accepts a leading `export ` and spaces around `=` in `.env`, and still runs nothing; verify with `build_test.sh`
- [ ] 7.5 README: a shell variable wins only when set and non-empty; the database URL warning; creating `xana-pdt-credentials`; bash only; the `.env` forms
