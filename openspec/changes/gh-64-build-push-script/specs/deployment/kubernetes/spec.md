# Spec Delta

## ADDED Requirements

### Requirement: Build and push script
`build.sh` SHALL build the backend and frontend images and push them as `<REGISTRY>/xana-ai-pdt-<name>:<IMAGE_TAG>`, with `REGISTRY` defaulting to `k3d-iff.localhost:12345` and `IMAGE_TAG` to `latest`, taking shell variables before an optional `build.conf`.

#### Scenario: Defaults
- **WHEN** `./build.sh` runs with no settings
- **THEN** both images are built and pushed to `k3d-iff.localhost:12345` with tag `latest`, and the registry, tag and image names are printed first

#### Scenario: Registry and tag from the shell
- **WHEN** `REGISTRY=<host>/<path> IMAGE_TAG=1.2.3 ./build.sh` runs against a registry
- **THEN** `<host>/<path>/xana-ai-pdt-backend:1.2.3` and `<host>/<path>/xana-ai-pdt-frontend:1.2.3` are in that registry

#### Scenario: Config file and shell
- **WHEN** `build.conf` sets the registry and tag, and the shell sets the tag too
- **THEN** the registry from the file and the tag from the shell are used

#### Scenario: A config file it can't read
- **WHEN** `build.conf` holds another key or a line that isn't `KEY=VALUE`
- **THEN** the script stops before building, naming the line

#### Scenario: Build only, and one image
- **WHEN** the script runs with `--no-push`, or with `backend` or `frontend`
- **THEN** nothing is pushed, or only that image is built

#### Scenario: Failures
- **WHEN** an option is unknown, or a build or a push fails
- **THEN** the script ends with a non-zero exit and says what failed

#### Scenario: The chart finds the images
- **WHEN** the chart is rendered with the same `imageRegistry` and `imageTag`
- **THEN** its images are exactly the pushed ones

#### Scenario: Checked in CI
- **WHEN** CI runs
- **THEN** it runs the script with `--no-push`, and shellcheck passes on it
