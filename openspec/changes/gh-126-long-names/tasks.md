# Tasks

## 1. Shortening

- [ ] 1.1 Shorten a long URN or prefixed name in the middle, keeping its start (D1); verify with unit tests for each kind, for names that stay as they are, and that an http IRI itself is never shortened
- [ ] 1.2 Offer *Show in full* and *Abbreviate*, and the name in full in the tooltip (D2); verify with a unit test on a relationship's long target
- [ ] 1.3 Shorten a heading that falls back to a long ID's last segment (D3); verify with a unit test

## 2. Checks

- [ ] 2.1 Run the frontend lint, unit tests, build, bundle check and end-to-end tests; verify they pass
- [ ] 2.2 On the local platform, open an OPC UA entity; verify its heading, ID, relationship target and vocabulary value are shortened, and that a name is shown in full and back from its menu
