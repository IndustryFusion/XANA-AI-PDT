# Tasks

## 1. Namespaces and addresses

- [x] 1.1 `namespace: xana-pdt` and `platformNamespace: iff` in `default.yaml`; the platform address keys empty there and filled from `platformNamespace` in `values.yaml.gotmpl`; verify all three environments render, and that a changed `platformNamespace` and a given address behave as specified
- [x] 1.2 `check_values.py`: the new keys in its tables, and checks for the derived and the given addresses; verify they fail when undone

## 2. Database credentials

- [x] 2.1 Keys `databaseUsername` and `databasePassword`, shell `DATABASE_USERNAME` and `DATABASE_PASSWORD`; the chart's `<release>-database` Secret, percent-encoded, with its checksum on the backend Deployment; `databaseCredentialsSecret` as the fallback, empty by default; the render stop; `NOTES.txt` naming the source
- [x] 2.2 `check_render.py`: from the shell, a copied Secret, neither, only one, special characters, only Secrets the chart renders, and a changed credential changing the checksum; verify each fails when undone

## 3. Cluster secrets helper

- [x] 3.1 `envs/iff-cluster.sh` exports `DATABASE_USERNAME` and `DATABASE_PASSWORD` from `IFF_DATABASE_SECRET`, and reports a kept value that differs; `iff_cluster_test.sh` covers both, prints no secret; shellcheck

## 4. Local test cluster and CI

- [x] 4.1 Stand-ins in `iff` with a password needing encoding, the lookup Secret in `xana-pdt`, XANA in `xana-pdt` after sourcing the helper; CI's render steps with test credentials; verify on a local kind cluster with an explicit KUBECONFIG, then on the Pull Request
- [x] 4.2 CI checks on that cluster: the backend ready, no Secret it doesn't render, URLs naming `acid-cluster.iff`, the lookup, the smoke test and the restart

## 5. Documents

- [x] 5.1 `helm/README.md`: the namespace, `platformNamespace`, the database credentials and a password change, copying a Secret, the network policy note, the `callbackBaseUrl` example, moving an install from `iff`, the commands with `-n xana-pdt`, and the key table; `architecture.md`'s deployment section
