# Spec Delta

## ADDED Requirements

### Requirement: Machine events and operators' tokens
With sessions per operator, the machine events subscription and triggered rounds SHALL use the service identity only, under the recommended options of decisions 2 and 4. An operator's answer starts a round with that operator's token.

#### Scenario: No service client, an operator signed in
- **WHEN** no service client is configured, sign-in is on, and an operator is signed in
- **THEN** the subscription isn't made with that operator's token, and the `machine_events` check says that it waits for a service identity

#### Scenario: A triggered round with no service client
- **WHEN** a triggered run's first round reads the platform, with no service client, and an operator signed in
- **THEN** its calls carry no token

#### Scenario: A service client
- **WHEN** a service client is configured, and any number of operators are signed in or none
- **THEN** the subscription and triggered first rounds use its token

## REMOVED Requirements

### Requirement: Service identity
**Reason**: Its scenarios "A triggered run while an operator is signed in" and "Not configured" fall back to the signed-in operator, which sessions per operator end. Replaced by "Machine events and operators' tokens" and `backend/run-identity`.
**Migration**: A deployment that relied on the fallback needs a service client for machine events.
