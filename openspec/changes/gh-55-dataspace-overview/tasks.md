# Tasks

## 1. Backend

- [x] 1.1 Work out access levels and counts in `policies` and `peers`; verify with stub tests for each rule, a peer that can't be read, and not connected
- [x] 1.2 Add addresses and the client in use to `/api/gateway/config`; verify with a test that searches the answer for the secret, the key and a token, and that a password in an address is masked
- [x] 1.3 Look up names in the directory, kept for 300 seconds and read again when the token changes, then the factory's owner; verify with stub tests, including concurrent lookups reading the directory once
- [x] 1.4 Add `/api/ifric/resolve-machines`; verify with stub tests for a known, an unknown and a failing asset

## 2. Frontend

- [x] 2.1 Counts and elevated peers in the dashboard tile; verify with component tests, including unknown and not connected
- [x] 2.2 Level per peer and the configuration panel on the Dataspace screen; verify with component tests, including one that searches the rendered panel for a secret
- [x] 2.3 The builder's current access in the approval panel, with refresh and failure; verify with component tests
- [x] 2.4 Asset names next to machine IDs in the run list, run view and incident history; verify with component tests with the registry answering and failing
- [x] 2.5 Serve and document the new fields and route in both data sources; verify with source tests

## 3. Verification with real services

- [ ] 3.1 Levels on the dashboard and the Dataspace screen as the gateway reports them, after approving and denying capabilities for peers; verify against the dataspace's gateway with more than one peer
- [ ] 3.2 The approval panel against a real data request, before and after changing the builder's access; verify on the same services
- [ ] 3.3 Names from a real IFRIC registry, and the screens with the registry stopped; verify in a browser
- [ ] 3.4 The configuration panel in a browser; verify it shows no secret

## 4. Documents

- [x] 4.1 Update `frontend/docs/data-interface.md` and `architecture.md`; verify by reading the gateway and registry rows
