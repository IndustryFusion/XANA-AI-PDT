## ADDED Requirements

### Requirement: Managed memory schema
The backend SHALL create and update the incident memory schema itself. Schema migrations are applied in order and recorded, so each migration is applied exactly once.

#### Scenario: Empty database
- **WHEN** the backend starts against an empty memory database
- **THEN** all migrations are applied in order and recorded as applied

#### Scenario: Restart
- **WHEN** the backend starts again against a database where all migrations are already applied
- **THEN** no migration is applied again and the data is unchanged

#### Scenario: New migration
- **WHEN** a newer backend version with one additional migration starts against an existing database
- **THEN** only the new migration is applied

#### Scenario: Failing migration
- **WHEN** a migration fails
- **THEN** none of its changes remain and it is not recorded as applied. The memory check in the health report is `error` and names the migration.

### Requirement: Memory reachable later
When the memory database is unreachable at startup, the backend SHALL apply pending migrations once the database becomes reachable, without a restart.

#### Scenario: Database starts after the backend
- **WHEN** the backend starts before the memory database and the database becomes reachable later
- **THEN** the next health check finds it, applies the pending migrations and reports memory as `ok`
