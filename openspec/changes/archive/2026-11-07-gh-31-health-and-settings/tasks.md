# Tasks

## 1. Backend

- [x] 1.1 Add the checks, with probe and hint; verify each with a stub for up, down, 401, 403 and, for Fuseki, empty
- [x] 1.2 Add `GET /api/config`; verify that no secret or password is in it, and no route accepts an address
- [x] 1.3 Verify a finished run stays until archived, with a test

## 2. Frontend

- [x] 2.1 Serve the settings from the backend, read-only; verify with source and component tests
- [x] 2.2 Show each check's probe and hint; verify with a component test
- [x] 2.3 Remove the fall-through to the mock; add a test confirming the backend source doesn't use it
- [x] 2.4 Update `frontend/docs/data-interface.md`; verify every operation is shown as backed by the backend

## 3. Verification with real services

- [x] 3.1 Stop each service in the local environment; verify only its own check turns red, and the rest of the app keeps working
- [x] 3.2 A real Fuseki with an empty dataset gives a warning; a real Alerta with a wrong key gives a failure
- [x] 3.3 A full walk through the app on the local platform in a browser, with no mock data on any screen; record it in the Pull Request

## 4. Documents

- [x] 4.1 Update `backend/README.md` and `architecture.md`; verify by search
