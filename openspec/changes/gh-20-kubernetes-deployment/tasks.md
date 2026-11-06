# Tasks

## 1. Images

- [x] 1.1 Add `frontend/Dockerfile` and its nginx template with proxies for `/api`, `/ws` and `/api/ngsi/ws`, a 300 second proxy timeout and a 64 MB body limit; verify by running the image against a backend, including a WebSocket and an upload over 1 MB
- [x] 1.2 Make the backend image production-ready, and add `/healthz`; verify the image starts as a non-root user with no dependencies reachable, and `/healthz` answers

## 2. Settings

- [x] 2.1 Add `POSTGRES_SSLMODE` and `POSTGRES_SSLROOTCERT`, and apply them to both database URLs; verify with config tests, including URLs that already state them

## 3. Chart

- [x] 3.1 Add the chart `xana-pdt`: Deployments, Services, ConfigMap, Ingress, probes, resources, the default in-cluster addresses; verify with `helm lint` and `helm template`
- [x] 3.2 Add the three secret sources in order of preference; verify with `helm template` for each, and that no secret value appears in a ConfigMap
- [x] 3.3 Add Helmfile and environment values; verify `helmfile template` for each environment

## 4. CI

- [x] 4.1 Add a workflow that builds both images, and checks the chart on pull requests; verify it runs green on this Pull Request
- [x] 4.2 Add publishing from version tags; verify by reading the workflow, as no tag is pushed in this change

## 5. Install

- [x] 5.1 Install from the documented steps on a fresh local cluster with stand-in services; verify all Pods reach ready
- [x] 5.2 On that install, start a run and follow its live stream through the Ingress; verify the run reaches a waiting state with steps delivered
- [x] 5.3 On that install, restart the backend; verify runs and incidents are kept
- [ ] 5.4 Install on a cluster running the platform; verify all Pods reach ready, and the health report shows each connection ok
- [x] 5.5 Confirm no credentials or environment-specific hosts are committed; verify by searching the change

## 6. Documents

- [x] 6.1 Add `helm/README.md`, update `backend/README.md` and `frontend/README.md`, and correct Deployment Architecture in `architecture.md`; verify the steps are the ones used in 5.1

## 7. Integration check

- [x] 7.1 Run backend and frontend tests, lint and `openspec validate --all --strict`; verify they pass locally and in CI
- [x] 7.2 Check each scenario in the delta specs and report the result per scenario in the Pull Request; verify the report covers every scenario

## 8. Review follow-ups

- [ ] 8.1 Changes to the images' own files run the workflow; verify the workflow's paths against both Dockerfiles, and that it runs on this Pull Request
- [x] 8.2 The chart job checks secret precedence, and that no secret reaches a ConfigMap; verify with `helm/test/check_render.py`, including that it fails on a wrong chart
- [ ] 8.3 Helmfile takes install-time secrets from the shell; verify in the workflow
- [x] 8.4 A CA certificate can be mounted from a Secret; verify with `helm/test/check_render.py`
- [x] 8.5 Both Pods set a seccomp profile; verify with `helm/test/check_render.py`
- [ ] 8.6 Any non-secret setting can be passed through Helmfile; verify in the workflow
- [ ] 8.7 The smoke test checks every analysis step, that a large body reaches the backend, and that the incident survives a restart; verify in the workflow
- [ ] 8.8 Images are published only after the chart and install jobs pass; verify by reading the workflow, and that the job runs after them on this Pull Request

## Workflow follow-up

- After merge, run `/opsx:archive gh-20-kubernetes-deployment` in a follow-up Pull Request from a fork, with `Closes #20` in its description.
