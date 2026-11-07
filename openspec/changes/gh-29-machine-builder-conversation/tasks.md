# Tasks

## 1. Backend

- [ ] 1.1 Add `INBOX_POLL_INTERVAL_S`, the migration and storing a run with its processed message in one transaction; verify against PostgreSQL
- [ ] 1.2 Add the inbox poller and order; verify a failure at each step, a crash before acknowledging, and concurrent polls
- [ ] 1.3 Add routing; verify a test for each performative received
- [ ] 1.4 Add sending, grant, deny and the recommendation's answers; verify each refusal and a failure at each step
- [ ] 1.5 Add stop, reopen and reopening an incident; verify each case including those not reopenable
- [ ] 1.6 Add the status check, recording a close, and adding what the gateway holds; verify a restart between send and store
- [ ] 1.7 Record the chat and state in incidents; verify against PostgreSQL

## 2. Agent

- [ ] 2.1 Add the agent, tools and prompts; verify that nothing in it can send, with the limits on reads
- [ ] 2.2 Test the ontology's query through the agent's real path, with a stand-in model server and a real Fuseki with a listener
- [ ] 2.3 Add evaluation cases and their runner; verify in pytest, with a case that fails when something would be sent

## 3. Frontend

- [ ] 3.1 Serve the operations from the backend source, free-text requests and outcomes; verify with source and component tests and shapes from a real backend

## 4. Verification on a real dataspace

- [ ] 4.1 A full exchange: escalate, builder asks for more data, operator grants, builder recommends, close; verify with the real services, the builder acting through its own token, and reading the files it got
- [ ] 4.2 A restart in mid-conversation on the real services loses nothing, and handles nothing twice
- [ ] 4.3 Reopen and stop on the real services, including `escalated` refused
- [ ] 4.4 The exchange in a browser

## 5. Documents

- [ ] 5.1 Update `backend/README.md`, `frontend/docs/data-interface.md`, `architecture.md`; verify by search
