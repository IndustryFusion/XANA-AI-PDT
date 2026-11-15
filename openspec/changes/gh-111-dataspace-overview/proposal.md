# Proposal

Issue: #111

## Why

The Dataspace area spreads its overview over five cards and says the connection state twice. It shows capability statuses that hide what the gateway applies, ignores the gateway's capability names, and says little when connecting fails (#111). Operators need a glance at whether the dataspace works, how long the session lasts and what each peer may do. When connecting fails, they need to know which step failed.

## What Changes

- **One gateway card:**
  - the connection state, once;
  - a token box with the expiry and the time left, marked in the last minute;
  - the addresses, realm, participant and factory;
  - the data-sharing tier in one line, with its explanation behind a disclosure.
  
  The separate configuration card goes away, and the peers follow right below.
- **Gateway statuses:** peer capabilities show the gateway's status (auto, on request, pending, approved, denied) beside the existing mapping, and the actions follow from it (approve, deny, reset), each confirmed as today. *Grant* is called *Approve*, as on the gateway.
- **Capability names:** the gateway's label and description are shown where it gives them. The page's own names follow the gateway's: machine twin, neighbouring machines, machine history.
- **Connect details:** a failed connect names the step (identity provider or gateway) and gives the address with credentials masked, the client, the HTTP status and the identity provider's OAuth error code, behind a disclosure. Never a secret or a token.
- **Sign-in needed:** when the gateway is set up but no client is known (no company from the sign-in, none configured), the status says so, and the area asks the operator to sign in.
- **Peer list:** each peer's participant type, and for an elevated peer the capabilities granted beyond the defaults, marked by sensitivity.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `operator-ui/dataspace`: *Connection*, *Compatible peers*, *Peer policy*, *Data-sharing tier explained*, *Area works when disconnected or failing*, *Access level per peer*, *Configuration panel*.
- `backend/dataspace-connection`: *Dataspace token* (details of a refusal, sign-in needed), *Peers and capabilities* (gateway status, participant type and approved capabilities in the list).

## Out of Scope

- Machine builder names in the incident lists: a separate change.
- Changing the data-sharing tier from the page; it stays part of the deployment configuration.
- Token claims or other diagnostics beyond the connect details.

## Impact

- Backend: the dataspace connection (refusal details, sign-in-needed status), the gateway client (peer list, capability statuses), and refusals that can carry details.
- Frontend: the Dataspace area (gateway card, tier, peers, policy actions), the data-source contract and the mock source, and errors that carry details.
- Tests: gateway tests in the backend, dataspace and data-source tests in the frontend, dataspace, accessibility and layout end-to-end tests.
- architecture.md: none of its sections are affected.
