# Spec Delta

## MODIFIED Requirements

### Requirement: Stable error kinds
Every refused request SHALL carry an error kind (`not_found`, `conflict`, `invalid`, `unavailable`, `unauthorized`) and a readable message, with a matching HTTP status. `unavailable` answers 503 for the backend's own state, and 502 for a service behind the backend that cannot be used.

#### Scenario: Error shape
- **WHEN** any request is refused
- **THEN** the response holds the kind and the message, and the HTTP status is 404, 409, 422, 503 or 401 respectively, or 502 for a service behind the backend
