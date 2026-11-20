# Spec Delta

## ADDED Requirements

### Requirement: Whose token a round uses
Each round of a run SHALL use the identity the design's table gives, and SHALL record which kind on its steps: `operator`, `service` or `none`.

#### Scenario: Started by an operator
- **WHEN** an operator starts a run with others signed in
- **THEN** its first round's platform calls carry that operator's token

#### Scenario: Answered by another operator
- **WHEN** a second operator answers a run's question
- **THEN** the round that follows carries the second operator's token

#### Scenario: A triggered run answered by an operator
- **WHEN** an operator answers a triggered run's question
- **THEN** the round that follows carries that operator's token, not the service identity's

#### Scenario: Signed out during a round
- **WHEN** the operator signs out during a round, and a service identity is configured
- **THEN** the round goes on with the service identity, and the step says so

#### Scenario: Signed out with no service identity
- **WHEN** the operator signs out during a round, and no service identity is configured
- **THEN** the round goes on without a token, and what can't be read shows as an unavailable source

#### Scenario: A paused run
- **WHEN** the operator who started a paused run signs out
- **THEN** the run stays as it is, and the next operator's answer gives the next round its token

#### Scenario: A restart
- **WHEN** a round runs again after a restart
- **THEN** it uses the service identity, or no token, as no session survives

#### Scenario: Nothing outlives a sign-out
- **WHEN** an operator has signed out
- **THEN** no call of any run carries that operator's token, and the refresh token has been ended at the provider
