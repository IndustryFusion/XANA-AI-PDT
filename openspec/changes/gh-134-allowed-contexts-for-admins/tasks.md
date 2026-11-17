# Tasks

## 1. Backend

- [ ] 1.1 Read the signed-in operator's roles on the platform's client from the session's own token (D1); verify with backend tests for a token with the role, without it, on another client, and malformed claims
- [ ] 1.2 Refuse adding, removing and the risks check without `Factory-Admin` as `unauthorized` with HTTP 403, naming the role, and refuse them without sign-in (D2–D5); verify with backend tests for each operation, `Factory-Reader`, `Factory-Writer`, no role, and an admin
- [ ] 1.3 Say in the list whether the operator may change it and which role may (D7); verify with backend tests for both cases
- [ ] 1.4 Say in the import's refusal that an operator with `Factory-Admin` can allow the context in the System area; verify with backend tests for a named and an unnamed refused context
- [ ] 1.5 Build in the well-known contexts with their labels, leaving out redirect services (D6); verify with backend tests for each entry, look-alikes, `w3id.org` and `purl.org`, and the labels in the list
- [ ] 1.6 End to end: sign in through the backend at a real Keycloak as an operator with `Factory-Admin` and as one without, and add and remove a context in the real memory database; verify with a services test run in CI

## 2. System area and data sources

- [ ] 2.1 Show the list read-only without the role, saying which role may change it, and each built-in context with its label (D7); verify with unit tests for both cases
- [ ] 2.2 Add `mayChange`, `changeRole` and `label` to the documented shape in both sources, and the mock's development control that refuses as the backend does; verify with the data-source tests, the shape tests on recorded backend answers, and a 403 received as `unauthorized`
- [ ] 2.3 End to end on the mock source: an admin adds a context, and without the role the list is read-only; verify with a browser test

## 3. Checks

- [ ] 3.1 Run the backend and frontend suites, the build, the bundle check and the end-to-end tests, and measure the coverage of the changed code; verify they pass and the coverage is above 80 %
- [ ] 3.2 On a local IFF platform, sign in as an operator with `Factory-Admin` and as one with `Factory-Reader` only; verify the admin adds and removes a context, the other sees the list read-only and is refused with 403, and the built-in contexts are listed with their labels
