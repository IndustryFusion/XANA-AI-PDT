# Spec Delta

## ADDED Requirements

### Requirement: Names from the registry
The backend SHALL resolve participant IDs to company names at `/api/ifric/resolve`, from the configured registry, with the dataspace token.

#### Scenario: Known company
- **WHEN** a known company's ID is resolved, in a list or a single answer, as a full record or a public profile
- **THEN** its name is returned

#### Scenario: Unknown company
- **WHEN** the registry answers `200` with `{company: null}` or an empty list
- **THEN** that ID is left out, and the others are returned

#### Scenario: Failed lookup
- **WHEN** a name lookup is refused, times out or fails
- **THEN** that ID has an empty name, and the others are returned

#### Scenario: Identifier encoding
- **WHEN** an identifier holds `:` or `/`
- **THEN** it reaches the registry as one encoded path segment, with `:` as `%3A`

#### Scenario: Peers named
- **WHEN** peers are listed on the dataspace routes and the registry knows the company
- **THEN** a peer's name is its company's, and without an answer it is its ID

### Requirement: Machine builders
The backend SHALL find a machine's builder from `GET /company/assets/{id}/manufacturer`, asking with the machine's entity ID, and offer names at `/api/ifric/resolve-builders`.

#### Scenario: Builder found
- **WHEN** the registry names the machine's manufacturer
- **THEN** its company ID and name are known, and `resolve-builders` returns the name by machine ID

#### Scenario: No builder known
- **WHEN** the registry answers `200` with `{company: null}`
- **THEN** there is no builder, and the reason says the registry does not know the machine

#### Scenario: Refused
- **WHEN** the registry answers `403`
- **THEN** there is no builder, and the reason says this company is not a party to the machine

#### Scenario: Unavailable
- **WHEN** the registry can't be reached, times out, fails, or there's no dataspace token
- **THEN** there is no builder, and the reason says so, for the escalation to show

### Requirement: Factory details
The backend SHALL answer `/api/ifric/factory` with the factory of the operator's `ifric_factory_id` claim or `FACTORY_ID`.

#### Scenario: Factory found
- **WHEN** the registry knows the factory
- **THEN** its ID, location name, owner name, city and country are returned

#### Scenario: Owner refused
- **WHEN** the factory is readable and its owner answers `403`, `{owner: null}` or fails
- **THEN** the factory is returned without an owner

#### Scenario: Public fields only
- **WHEN** a field isn't in the answer
- **THEN** it is left out of the result rather than made up, and without a city and country there is no location

#### Scenario: Unknown factory
- **WHEN** the registry answers `200` with `{factory: null}`, or no factory ID is known
- **THEN** the request is refused as `not_found`

#### Scenario: Factory unavailable
- **WHEN** the registry refuses, can't be reached or fails
- **THEN** the request is refused as `unavailable`

### Requirement: Configuration and state of the registry
`/api/ifric/config` and `/api/ifric/status` SHALL report whether the registry is configured and works.

#### Scenario: Not configured
- **WHEN** `IFRIC_URL` is not set
- **THEN** the configuration says so, names are left out, there is no builder with a reason, and the factory is `unavailable`

### Requirement: Backend only
The registry SHALL be used by the backend only.

#### Scenario: Not an agent tool
- **WHEN** the agent package is inspected
- **THEN** nothing in it reaches the registry
