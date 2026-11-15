# Tasks

## 1. Backend

- [ ] 1.1 Let refusals carry `details` and fill them for connect failures (D3); verify with backend tests that a rejected secret and an unreachable provider or gateway name the step, the masked address, the client, the HTTP status and the provider's OAuth error code, and never the secret or the provider's description
- [ ] 1.2 Add `needs_sign_in` to the status (D4); verify with a backend test for a configured gateway without a client, and with one
- [ ] 1.3 Add `gateway_status` to capabilities, and `participant_type` and `approved` to the peer list (D1, D6); verify with backend tests for each gateway status and an unknown one, and the peer list

## 2. Dataspace area

- [ ] 2.1 One gateway card with the token box, the configuration rows and the tier line (D5); verify with unit tests for the connected card, the token box tones and the countdown, a renewed token starting again without the mark, the tier disclosure, and that no secret or password appears
- [ ] 2.2 Statuses and actions by the gateway's status, and the gateway's names (D1, D2); verify with unit tests that each status shows its label and actions, that approving a capability on request shows it approved, and that a gateway label is shown
- [ ] 2.3 Connect details and the sign-in hint (D3, D4); verify with unit tests that a failed connect shows the step and details behind a disclosure, and that without a client the area asks to sign in and offers no connect form
- [ ] 2.4 Peer type and grants in the list (D6); verify with unit tests for the type, including one given as an IRI, and the pills of an elevated peer
- [ ] 2.5 Extend the data-source contract and the mock source; verify with the data-source tests

## 3. Checks

- [ ] 3.1 Run the backend and frontend suites, the build, the bundle check and the end-to-end tests; verify they pass
- [ ] 3.2 On the local platform, check the gateway card, the token box, the peers' types and statuses and the gateway's labels; verify they show as described
