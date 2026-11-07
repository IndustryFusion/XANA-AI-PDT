# Tasks

## 1. Backend

- [x] 1.1 Accept `LANGFUSE_BASE_URL` as well as `LANGFUSE_HOST`, and stop on two different addresses; verify with config tests
- [x] 1.2 Traces reach the configured address, and nothing is sent without keys; verify with a stand-in HTTP server that records requests, with the tracing package installed, and check the test fails when the address isn't passed

## 2. Deployment

- [x] 2.1 Pass the address from the chart value and `XANA_LANGFUSE_HOST`; verify with `helm template` and the render check, with and without an address
- [x] 2.2 Run the backend with the environment rendered by the chart against the stand-in server; verify that traces arrive there

## 3. Documents

- [x] 3.1 Update `backend/.env.example`, `backend/README.md`, `helm/README.md` and `architecture.md`; verify by searching for both names
