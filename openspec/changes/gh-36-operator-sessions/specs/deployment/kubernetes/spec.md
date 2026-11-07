# Spec Delta

## ADDED Requirements

### Requirement: No passwords over plain HTTP by default
A default deployment with sign-in SHALL NOT accept a password over plain HTTP.

#### Scenario: No TLS Secret
- **WHEN** the chart renders with sign-in on, no TLS Secret and no explicit setting
- **THEN** rendering fails, saying what to set

#### Scenario: Explicitly allowed
- **WHEN** `allowInsecureSignIn` is set
- **THEN** it renders, with `ALLOW_INSECURE_SIGN_IN=true`

#### Scenario: With TLS
- **WHEN** a TLS Secret is set
- **THEN** it renders, trusts only the Ingress for the forwarded protocol, and the cookie is `Secure`

### Requirement: The warning reflects what is protected
`helm/README.md` SHALL say what the deployment protects, and no longer warn about what this change closes.

#### Scenario: Read after delivery
- **WHEN** an installer reads the warning
- **THEN** it no longer says that a visitor can pass the sign-in screen, use an operator's token, read their name or sign them out, and it says what remains: every signed-in operator has the same rights in XANA
