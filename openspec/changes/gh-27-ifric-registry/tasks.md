# Tasks

## 1. Backend

- [ ] 1.1 Add the `IFRIC_URL` setting; verify with config and redaction tests and `.env.example`
- [ ] 1.2 Add the registry client: encoded identifiers, list answers, `null` answers, 10 second timeouts; verify with stub tests for each answer's form, checking the raw path
- [ ] 1.3 Add names, builders and the factory with each failure as the design says; verify with stub tests of not found, 403 and unavailable for each, and concurrent lookups with one failing
- [ ] 1.4 Add the routes under `/api/ifric`, and name peers; verify with stub tests
- [ ] 1.5 Add the `ifric` health check; verify with tests that 401 and 403 are failures
- [ ] 1.6 Verify that nothing in the agent package reaches the registry, with a test

## 2. Frontend

- [ ] 2.1 Serve the operations from the backend source without mapping keys; verify with source tests and shapes from a real backend
- [ ] 2.2 Screens show an identifier for an empty name, and leave out missing factory fields; verify with component tests

## 3. Local environment and deployment

- [ ] 3.1 Add the stub under a profile; verify by running it against the backend
- [ ] 3.2 Add `ifricUrl` to the chart; verify with `helm template`

## 4. Verification

- [ ] 4.1 Builder, peer names and factory details from a real registry; verify with the registry run from its own repository, on the dataspace's realm, from the backend and in a browser
- [ ] 4.2 Not found, 403 and unavailable on a real registry; verify with a machine it doesn't know, a machine this company isn't a party to, and the registry stopped
- [ ] 4.3 Health reports the true state; verify in each of those states
- [ ] 4.4 The retired token setting and the products route named in the issue appear in no code or current document; verify by search

## 5. Documents

- [ ] 5.1 Update `backend/README.md`, `helm/README.md`, `frontend/docs/data-interface.md`, `architecture.md`; verify by searching for each setting
