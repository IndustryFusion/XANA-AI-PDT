# Spec Delta

## ADDED Requirements

### Requirement: Escalation preflight
`GET /api/agent/escalate-preflight/{id}` SHALL report whether escalation is possible, from the run, the dataspace token, the machine builder and the capability access, with the recipient, tier and data that would be sent, and sending nothing.

#### Scenario: Possible
- **WHEN** the run waits for input or confirmation, the backend is connected, the registry names the machine's builder, and it is a compatible peer
- **THEN** the answer is possible, naming the recipient, the tier, and each item of data with its capability

#### Scenario: Run state
- **WHEN** the run is in another state, or is already escalated
- **THEN** the answer is not possible, and the reason says so

#### Scenario: No dataspace or token
- **WHEN** no dataspace is configured, or the backend isn't connected, or the token has run out
- **THEN** the answer is not possible, and the reason tells these apart

#### Scenario: No builder
- **WHEN** the registry isn't configured, doesn't know the machine, refuses, or can't be reached
- **THEN** the answer is not possible, and the reason tells these apart

#### Scenario: Not a peer
- **WHEN** the builder is not among the compatible participants, or the gateway can't list them
- **THEN** the answer is not possible, and the reason tells these apart

#### Scenario: Nothing may be sent
- **WHEN** the builder's access to the machine's own data is denied, or access can't be read
- **THEN** the answer is not possible, and the reason says so

### Requirement: Data filtered to the tier
Before sending, the backend SHALL filter the data to `DATA_SHARING_POLICY` and to the capability access the dataspace reports, and SHALL add a `policy_check` step with the tier, what is sent and what is withheld and why.

#### Scenario: Minimal
- **WHEN** the tier is `minimal`
- **THEN** only the machine's entity data is sent

#### Scenario: Adjacent
- **WHEN** the tier is `adjacent` and access is allowed
- **THEN** the machine's entity data and related entities are sent, and no history

#### Scenario: Timeseries
- **WHEN** the tier is `timeseries` and access is allowed
- **THEN** entity data, related entities and history are sent

#### Scenario: History without related entities
- **WHEN** history is allowed and related entities aren't, also for a grant of history alone
- **THEN** the history holds only the machine's own signals

#### Scenario: Access not allowed
- **WHEN** the tier includes a capability whose access is `on-request`, `pending` or `denied`
- **THEN** its data is withheld, and the policy check names it with the reason

#### Scenario: The message holds no more
- **WHEN** the incident message is sent, at any tier
- **THEN** it holds no related entity or history

### Requirement: Escalation
`POST /api/agent/escalate/{id}` SHALL send the data with `POST /outbox/files`, the incident with `POST /outbox/messages` as a `request` in the same conversation, and move the run to `awaiting_machine_builder` with an `ESC-…` reference.

#### Scenario: Sent
- **WHEN** the operator escalates a run where the preflight says it is possible
- **THEN** the builder's participant receives the files and the request in one conversation, and the run shows the reference, recipient, tier and data sent

#### Scenario: Not possible
- **WHEN** the preflight would say it is not possible
- **THEN** the request is refused, with the reason, and nothing is sent

#### Scenario: Files fail
- **WHEN** sending the files fails
- **THEN** the failure is shown as a step, the request names it, no message is sent, the status is unchanged, and clarifying, confirming and escalating again all work

#### Scenario: Message fails
- **WHEN** the files were accepted and sending the message fails
- **THEN** the failure is shown, and escalating again sends the message in the same conversation without sending the files again

#### Scenario: A source fails
- **WHEN** the data can't be read
- **THEN** nothing is sent, and the failure is shown

#### Scenario: At the same time
- **WHEN** two escalations of a run arrive together
- **THEN** one sends and the other is refused as `conflict`

#### Scenario: Other actions during a send
- **WHEN** an operator acts on the run while it is being sent
- **THEN** that is refused as `conflict`, and the stream goes on working

### Requirement: Delivery status
The backend SHALL poll the outbox status until it is final, and show it.

#### Scenario: Delivered
- **WHEN** the gateway reports `notified`
- **THEN** the message shows as `delivered`

#### Scenario: Still on its way
- **WHEN** the gateway reports `pending` or `registered`, or can't be asked
- **THEN** the message shows as `pending`, and is asked about again

#### Scenario: Failed
- **WHEN** the gateway reports `error` or `rejected`
- **THEN** the message shows as `failed` with the reason, and is not asked about again, and the run stays waiting

#### Scenario: Restart
- **WHEN** the backend restarts with a message not yet final
- **THEN** polling goes on
