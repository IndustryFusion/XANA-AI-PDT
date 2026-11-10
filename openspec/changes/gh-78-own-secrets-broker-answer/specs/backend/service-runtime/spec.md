## ADDED Requirements

### Requirement: The context broker's answer in its check
The broker check SHALL ask with `Accept: application/ld+json`. On any status but 200, its detail SHALL give the status, the masked address it called, whether a token was sent, and the start of the broker's answer (its `title` and `detail`, else its first 300 characters), with the token and configured secrets masked, and its hint SHALL name the usual causes in order.

#### Scenario: A refusal with an answer
- **WHEN** the broker answers 401 with problem details
- **THEN** the detail says it refused the token, with the status, the address, whether a token was sent, and the answer's title and detail, and no secret

#### Scenario: Another failure
- **WHEN** the broker answers 403 or 404
- **THEN** the detail gives that status, the address, whether a token was sent, and the start of the answer

#### Scenario: The hint
- **WHEN** the broker check isn't ok
- **THEN** its hint names, in order: nobody signed in, `KEYCLOAK_URL` not the issuer the broker checks, no role on client `scorpio`, and `NGSI_TENANT`
