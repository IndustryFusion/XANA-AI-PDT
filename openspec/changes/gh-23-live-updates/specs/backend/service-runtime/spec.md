# Spec Delta

## MODIFIED Requirements

### Requirement: Secrets stay secret
The backend SHALL NOT include secret settings (passwords, API keys, tokens) in any response, log line or error message, including tokens carried in the addresses of subscriptions.

#### Scenario: Secret in a connection address
- **WHEN** a dependency whose configured address contains a password fails its health check
- **THEN** the reported detail and the log show the address with the password masked

#### Scenario: Configuration error
- **WHEN** the backend refuses to start because of an invalid secret setting
- **THEN** the message names the variable but not its value

#### Scenario: Token in a subscription address
- **WHEN** a subscription is created, renewed or fails, at any log level
- **THEN** the token appears in no log line, response or error message

#### Scenario: Library log line
- **WHEN** a library logs an address with a password or a bearer token
- **THEN** the log shows it masked
