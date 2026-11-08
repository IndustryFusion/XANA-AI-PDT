# Tasks

## 1. Environment

- [ ] 1.1 Add `helm/environment/localAndIonos.yaml` with the header, the keys of the design as marked placeholders, and comments; verify no value is a secret or a real host
- [ ] 1.2 Add the environment to `helm/helmfile.yaml.gotmpl` with the layering; verify with `helmfile -e localAndIonos template`

## 2. Checks

- [ ] 2.1 Render `localAndIonos` in CI's loop, run the secret check on it, and check the layering; verify on the Pull Request, and that the layering check fails with the order reversed

## 3. Documents

- [ ] 3.1 Document the environment, its layering and its placeholders in `helm/README.md`, and in `architecture.md` where environments are named; verify by reading them
- [ ] 3.2 The values for the cluster: open for the maintainer; record the answer here when given
