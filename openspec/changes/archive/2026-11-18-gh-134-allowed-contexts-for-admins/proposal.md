# Proposal

Issue: #134

## Why

Since #130, any signed-in operator can add or remove an allowed context, including an internal address once the dialog's warning is accepted, and an API client never sees that warning. Every later import can then make the context broker fetch that address from inside the platform. The risks check also tells any signed-in operator whether a name resolves inside the network (notes 1–2 of #130's spec review, note 7 of its source review). And only the IFF contexts are built in, so an entity naming a widely used vocabulary, such as schema.org, is refused until someone adds it (#134).

## What Changes

- **Who may change the list:** only an operator whose token carries `Factory-Admin` on the platform's client (`KEYCLOAK_CLIENT_ID`, `scorpio` by default) can add or remove an allowed context, or check an address's risks. Anyone else is refused as `unauthorized` (HTTP 403), with the role named; without sign-in, nobody has it.
- **The import's refusal** says that an operator with `Factory-Admin` can allow the context in the System area.
- **Everyone still sees the list.** It says whether the operator may change it, and which role may. Without the role, the System area shows it read-only and says who may change it.
- **Built-in well-known contexts,** each served by its own host and listed with what it is: schema.org, ETSI NGSI-LD, Smart Data Models, FIWARE data models, W3C's vocabularies under `https://www.w3.org/ns/` and Verifiable Credentials 1.1, and GS1's Web Vocabulary. Redirect services such as `w3id.org` and `purl.org` are left out.
- **Data source:** the list's shape gains `mayChange`, `changeRole` and a `label` per context; the mock source gets a development control for an operator without the role.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `backend/explorer-api`: *Import* (the refusal says who may allow the context), *Allowed contexts* (the built-in list, labels, who may change it), *Allowing a context* (only `Factory-Admin`).
- `operator-ui/system-health`: *Allowed contexts* (read-only without the role, labels).
- `operator-ui/data-source`: *Allowed contexts from the backend* (whether the operator may change the list); new *Allowed contexts on the mock source*.

## Out of Scope

- Roles for anything else in XANA, and per-operator sessions (#36): the backend still holds one session, so the operator signed in last decides for every browser.
- Configuring which role may change the list.
- Bounding the time the risks check waits for name resolution (note 10 of #130's source review).

## Impact

Backend: `app/auth.py` (the operator's roles on the platform's client), `app/ngsi/contexts.py` (the built-in list with labels), `app/api/ngsi.py` (the role check), the README, and their tests, with an end-to-end test against Keycloak and the memory database. Frontend: the *Allowed contexts* card, the data interface and both sources, a mock development control, the interface documentation and recorded backend answers, and their tests, with an end-to-end test on the mock source.
