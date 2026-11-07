# Tasks

## 1. Backend

- [x] 1.1 Add the escalation statuses, migration and run fields; verify with tests of each status's operations, and a restart against PostgreSQL
- [x] 1.2 Add the data filter: tier and access; verify by test that each tier sends only its data, with the bytes of each file read back, and with each access status
- [x] 1.3 Add the plan and preflight; verify a test for every reason
- [x] 1.4 Add sending, the reference, and failure at every step; verify with stub tests that fail each request in turn, including retrying without sending the file again
- [x] 1.5 Add one operation at a time; verify with concurrent escalations and other actions during a blocked send, and that the stream still answers
- [x] 1.6 Add outbox polling; verify each status, a gateway outage, and a restart
- [x] 1.7 Record the builder, reference and outcome in incidents; verify against PostgreSQL

## 2. Frontend

- [x] 2.1 Serve the operations from the backend source with a longer limit for sends, and show delivery in the waiting panel; verify with source and component tests, and shapes from a real backend

## 3. Verification on a real dataspace

- [x] 3.1 An escalation reaches a real machine builder participant with the correct files; verify by downloading the ZIP as the builder, at each tier
- [x] 3.2 Preflight's reasons on real services: not connected, unknown machine, registry stopped, gateway stopped
- [x] 3.3 A restart during `awaiting_machine_builder` keeps the state; verify on the real services, killing the process
- [x] 3.4 A send failure is shown and the run can continue; verify with the gateway stopped, then going on, then escalating again
- [x] 3.5 Escalate in a browser on the real services

## 4. Documents

- [x] 4.1 Update `backend/README.md`, `frontend/docs/data-interface.md`, `architecture.md`; verify by search
