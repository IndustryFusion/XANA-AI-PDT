# Spec Delta

## ADDED Requirements

### Requirement: Every connection in the health report
The health report SHALL hold checks for `memory`, `timeseries`, `broker`, `llm`, `alerta`, `mqtt`, `pgrest`, `gateway`, `dataspace_connector`, `ifric`, `fuseki` and `machine_events`, each with its probe address, with any password masked, and a hint of what to look at.

#### Scenario: One service stops
- **WHEN** any one service stops
- **THEN** only its own check is `error`, the report still answers, and the rest of the app keeps working

#### Scenario: Refused
- **WHEN** a service answers 401 or 403
- **THEN** its check is `error`, and says it was refused

#### Scenario: An empty ontology
- **WHEN** Fuseki answers, and the dataset holds nothing
- **THEN** the check is `degraded`, and says so

#### Scenario: MQTT with nobody signed in
- **WHEN** sign-in is on, and nobody is signed in
- **THEN** the MQTT check is `degraded` if the broker can be reached, as credentials can't be checked

#### Scenario: Refused MQTT credentials
- **WHEN** the MQTT broker refuses the credentials
- **THEN** the check is `error`

#### Scenario: No secret
- **WHEN** an address holds a password, or a service needs a key
- **THEN** neither is in the report

### Requirement: Service settings
`GET /api/config` SHALL give the service addresses in use, read-only, and no route SHALL take an address for a backend call.

#### Scenario: Read
- **WHEN** a client asks for the settings
- **THEN** each has a key, a label and the address in use, with any password masked, and is marked as not editable

#### Scenario: A change
- **WHEN** a client sends anything to `/api/config` with another method
- **THEN** it is refused, and nothing changes
