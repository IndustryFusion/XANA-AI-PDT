# Tasks

At the maintainer's request, no tests are added or run for this change, no local cluster is used, and CI isn't waited for. Each task is verified by reading the change, and by `openspec validate --all --strict`.

## 1. Namespaces of the lookups

- [ ] 1.1 The chart resolves an entry's `namespace`: `$namespace`, `$platformNamespace`, a name, or none (`platformNamespace`); an unknown `$` name stops the render
- [ ] 1.2 `databaseCredentialsNamespace` in `default.yaml`, `values.yaml.gotmpl` and the chart, default `$platformNamespace`, named in the messages and the offline note
- [ ] 1.3 `default.yaml`: every default entry with its `namespace`, grouped under comments saying XANA's own or the platform's; Section 3's comments say where each is read; `local-values.sh`'s entries likewise

## 2. Cluster secrets helper

- [ ] 2.1 `envs/iff-cluster.sh`: `XANA_NAMESPACE` for `xana-pdt-credentials`, `IFF_NAMESPACE` for the rest, both printed, the readability check per namespace; its header

## 3. Broker check

- [ ] 3.1 `backend/app/health.py`: `Accept: application/ld+json`, the detail with the status, the masked address, whether a token was sent and the start of the answer, the token masked; the hint

## 4. Documents

- [ ] 4.1 `helm/README.md`: which Secret is read in which namespace, creating `xana-pdt-credentials` in `xana-pdt`, `databaseCredentialsNamespace`, `XANA_NAMESPACE`, the broker check's detail and hint, and what changes for an operator who created `xana-pdt-credentials` in `iff`
