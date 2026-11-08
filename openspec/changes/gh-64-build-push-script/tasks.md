# Tasks

## 1. Script

- [x] 1.1 Write `build.sh` with the settings, options, output and failures of the spec, and `build.conf.example`; git-ignore `build.conf`; verify with shellcheck
- [x] 1.2 Tests for the settings order, the config file refusals, the options and the exit codes, with `docker` replaced by a stub that records its calls; verify that each fails when its rule is broken

## 2. Real registry

- [x] 2.1 Push to a local registry container with a registry and path and tag from the shell; verify the two images are in it
- [x] 2.2 Defaults: push to a local registry at `k3d-iff.localhost:12345`, or say why not if that name can't be reached here
- [x] 2.3 Render the chart with the same `imageRegistry` and `imageTag`; verify its images are the pushed names

## 3. CI and documents

- [x] 3.1 Run `./build.sh --no-push` and shellcheck in CI; verify on the Pull Request
- [x] 3.2 Update `helm/README.md` and `architecture.md`; verify by reading the build section
