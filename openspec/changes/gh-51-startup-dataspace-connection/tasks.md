# Tasks

## 1. Backend

- [x] 1.1 Start the connection at startup with sign-in on as well as off; verify with app tests for sign-in on with nobody signed in, sign-in off, no gateway, no client ID, no secret, and a stored disconnect
- [x] 1.2 Retry while the dataspace is unreachable, every 60 seconds, and stop on a rejected credential, a disconnect or shutdown; verify with fake-clock tests for each, and that the backend serves requests meanwhile
- [x] 1.3 Keep a connection on sign-in of another company, and name the client in use in status and configuration; verify with tests
- [x] 1.4 Concurrent sign-in, connect and retry leave one token and one renewal loop; verify with a concurrency test that fails when the attempts are not serialised
- [x] 1.5 Give the connector check the reason and whether it is still trying, without addresses or secrets; verify with health tests and the redaction test

## 2. Verification on a real dataspace

- [x] 2.1 Restart the backend with sign-in on and nobody signed in; a machine builder's message reaches its run; verify with the dataspace's gateway, adapters, Keycloak and a machine-builder participant
- [x] 2.2 Start the backend while the dataspace's Keycloak is stopped; health shows the reason, and the backend connects once Keycloak is started; verify on the same services
- [x] 2.3 Start without a configured client; verify nothing changes from before, with the existing tests passing

## 3. Documents

- [x] 3.1 Update `backend/README.md` and `architecture.md`; verify by reading the paragraphs on the dataspace connection
