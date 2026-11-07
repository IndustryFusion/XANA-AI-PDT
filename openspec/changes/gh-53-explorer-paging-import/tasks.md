# Tasks

## 1. Backend

- [x] 1.1 Add `offset` and the total to the entities query, for the broker's evaluation and the backend's own; verify with stub tests for each, an invalid offset, and the header
- [x] 1.2 Add `attrs`, with context terms, and the projection after the backend's own evaluation; verify with stub tests that fail when matching uses the projected entity
- [x] 1.3 Add `has_attr`, alone and with `attrs`; verify with stub tests, including no match and a page of found entities read whole
- [x] 1.4 Send the import upsert as a replace; verify with a stub test of the request and the existing import tests

## 2. Frontend

- [x] 2.1 Page through results with the page in the URL, reset on a new query; verify with component tests
- [x] 2.2 Attribute selection and "Has attribute" in the query bar, kept in the URL; verify with component tests
- [x] 2.3 Say in the import dialog that import replaces; verify with a component test
- [x] 2.4 Serve offset, total, attribute selection, has-attribute and replacing import from both data sources, and document them; verify with source tests that the mock and the backend source agree

## 3. Verification on a real context broker

- [x] 3.1 Page a query with more matches than the limit to the end; verify against the local environment's Scorpio, comparing with the broker's own answers
- [x] 3.2 Selected attributes and has-attribute return what the broker returns for the same NGSI-LD query; verify by comparing the answers
- [x] 3.3 Re-import an entity with an attribute removed; verify the attribute is gone
- [ ] 3.4 The three in a browser against the backend

## 4. Documents

- [x] 4.1 Update `frontend/docs/data-interface.md` and `architecture.md`; verify by reading the entities query and import entries
