# Spec Delta

## ADDED Requirements

### Requirement: Database TLS settings
The backend SHALL apply a configured TLS mode and root certificate to its database connections, without overriding what a database URL already states.

#### Scenario: TLS required
- **WHEN** `POSTGRES_SSLMODE=require` is set
- **THEN** connections to the memory database and the time-series store use that mode

#### Scenario: URL already states a mode
- **WHEN** a database URL already has an `sslmode`
- **THEN** the URL keeps it

### Requirement: Liveness route
The backend SHALL answer a liveness route whether or not its dependencies are reachable, without checking them.

#### Scenario: Dependencies down
- **WHEN** no dependency can be reached, and a client requests the liveness route
- **THEN** it answers success at once
