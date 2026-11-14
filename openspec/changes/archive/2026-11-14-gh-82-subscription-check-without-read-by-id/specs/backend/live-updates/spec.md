# Spec Delta

## ADDED Requirements

### Requirement: Checking the subscription
At least once a minute, the backend SHALL check that the live-update subscription is still in place: by reading it by its ID, or, when that read is refused with 401 or 403, by finding it in the broker's list of subscriptions, or else by renewing it. A refused read by ID alone SHALL NOT make live updates `subscription_failed`, and SHALL NOT count as the subscription being gone.

#### Scenario: Read by ID refused, the list works
- **WHEN** the broker refuses reading the subscription by its ID with 403, and lists it
- **THEN** the check doesn't make live updates `subscription_failed`, the state is the one delivery reports, such as `active`, over several checks, and nothing is created or renewed for that

#### Scenario: Read by ID and list refused, renewal works
- **WHEN** the broker refuses reading the subscription by ID and listing subscriptions, and accepts its renewal
- **THEN** the check doesn't make live updates `subscription_failed`, and the state is the one delivery reports, such as `active`

#### Scenario: In place again after a failed check
- **WHEN** a check found live updates `subscription_failed`, and a later check finds the subscription in place by any of the three ways
- **THEN** the state is again the one delivery reports, such as `active`

#### Scenario: Gone, while the read by ID is refused
- **WHEN** the broker refuses reading by ID, and the subscription isn't in its list, or a renewal is answered as not found
- **THEN** the subscription is created again within a minute

#### Scenario: Nothing works
- **WHEN** the broker refuses reading by ID, listing and renewing the subscription
- **THEN** the state is `subscription_failed`, and the reason gives the HTTP status of the last answer and, for 401 or 403, that the operator's token lacks access, without the broker's message, the endpoint or a token

#### Scenario: Once a minute
- **WHEN** the read by ID is refused, whether the subscription was then found in place or not
- **THEN** it is checked again a minute later, not at every step in between
