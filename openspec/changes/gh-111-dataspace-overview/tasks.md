# Tasks

## 1. Backend

- [x] 1.1 Let refusals carry `details` and fill them for connect failures (D3); verify with backend tests that a rejected secret and an unreachable provider or gateway name the step, the masked address, the client, the HTTP status and the provider's OAuth error code, and never the secret or the provider's description
  - `tests/test_gateway.py`: *a rejected credential says where and why without the secret* (step, masked address, client, HTTP status, OAuth code, and neither the secret nor the provider's description) and *unreachable provider and gateway name the step*; *a refusal without details has none in its answer*.
- [x] 1.2 Add `needs_sign_in` to the status (D4); verify with a backend test for a configured gateway without a client, and with one
  - *without a company or a configured client it asks to sign in*, also checking that it is false without a gateway and with a client.
- [x] 1.3 Add `gateway_status` to capabilities, and `participant_type` and `approved` to the peer list (D1, D6); verify with backend tests for each gateway status and an unknown one, and the peer list
  - *a capability keeps the gateway status beside the policy* for each of the five statuses, *an unknown gateway status is not passed on*, and the peer list test with `participant_type` and `approved`.

## 2. Dataspace area

- [x] 2.1 One gateway card with the token box, the configuration rows and the tier line (D5); verify with unit tests for the connected card, the token box tones and the countdown, a renewed token starting again without the mark, the tier disclosure, and that no secret or password appears
  - `tests/dataspace/dataspace.test.jsx`: the connected card with the token box, *the session's time left ticks, and its last minute is marked as urgent*, *a renewed token starts the time left again, without the mark*, the tier disclosure test, and *the gateway card shows … no secret*.
- [x] 2.2 Statuses and actions by the gateway's status, and the gateway's names (D1, D2); verify with unit tests that each status shows its label and actions, that approving a capability on request shows it approved, and that a gateway label is shown
  - *selecting a peer lists both directions…* (Auto, On request, Denied, and the actions each offers), *approve a capability on request, and reset it to the default*, and the gateway's label *Machine builder documents* through the mock.
- [x] 2.3 Connect details and the sign-in hint (D3, D4); verify with unit tests that a failed connect shows the step and details behind a disclosure, and that without a client the area asks to sign in and offers no connect form
  - *a rejected credential and an unreachable gateway give different messages and keep the form* (the step and details behind the disclosure, no provider description), and *without a company from the sign-in it asks to sign in, and offers no connect*.
- [x] 2.4 Peer type and grants in the list (D6); verify with unit tests for the type, including one given as an IRI, and the pills of an elevated peer
  - *a participant type reads as words, also when the gateway gives it as an IRI* and *a peer shows its kind, and an elevated one what it was granted, by sensitivity*.
- [x] 2.5 Extend the data-source contract and the mock source; verify with the data-source tests
  - `tests/data/dataspace.test.js` and the shape test check `gatewayStatus`, `participantType`, `approved` and `needsSignIn`.

## 3. Checks

- [x] 3.1 Run the backend and frontend suites, the build, the bundle check and the end-to-end tests; verify they pass
  - Backend: ruff, 1170 tests and 134 agent tests. Frontend: eslint, 906 unit tests, the build, the bundle check and 173 end-to-end tests.
- [x] 3.2 On the local platform, check the gateway card, the token box, the peers' types and statuses and the gateway's labels; verify they show as described
  - On a local IFF platform connected to a dataspace gateway: the gateway card showed one state, the token box counting down from five minutes, the addresses and the factory. Both peers showed *Machine builder* and *Standard access*. The capability tables showed the gateway's labels, such as *Machine builder documents*, with *Auto* and *On request*, and Approve and Deny on the rows on request.
