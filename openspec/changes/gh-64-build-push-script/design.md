# Design

## Context

`deployment/kubernetes` ("Images built in CI") has CI build both images on Pull Requests and publish them only from a version tag. The chart names an image `<image.registry>/<name>:<image.tag>` (`xana-pdt.image`), with `image.registry` and `image.tag` from the environment's `imageRegistry` and `imageTag`. This change adds a way for an operator to make those images exist in their own registry. There is no conflict with `architecture.md` or the specs: CI's publishing is unchanged.

## Decisions

### Where settings come from

The shell first, then `build.conf`, then the defaults (`REGISTRY=k3d-iff.localhost:12345`, `IMAGE_TAG=latest`). `build.conf` is read as plain `KEY=VALUE` lines, not run as shell code, and only `REGISTRY` and `IMAGE_TAG` are taken; another key, or a line that isn't `KEY=VALUE`, stops the script and names the line. Comments and blank lines are allowed. `build.conf` is git-ignored, as it is per machine; it holds no secret.

Alternatives considered:

| Option | Why not |
|---|---|
| Source the file as shell | Runs whatever it holds; a typo becomes a command |
| Command-line flags for registry and tag | The issue asks for shell variables and a file; flags would be a third source |

### Options

`./build.sh [--no-push] [all|backend|frontend]`, with `all` the default, and `-h`/`--help`. An unknown option or target exits with status 2 and the usage. A failed build or push exits non-zero and names the image and the step.

### What is built

Each image from its own directory and Dockerfile, as CI builds it (`docker build backend`, `docker build frontend`), with no build arguments, tagged `<REGISTRY>/xana-ai-pdt-<name>:<IMAGE_TAG>`. A trailing `/` in `REGISTRY` is dropped, so the names match what the chart renders.

### Verifying

A local registry container (`registry:2`) for the acceptance criterion with a pushed image, and `helm template` with the same `image.registry` and `image.tag` compared with the pushed names. CI can't push, so it runs `--no-push` and shellcheck.

## Risks

- The script needs Docker and, for pushing, a login to the registry; it says so when a push fails.
