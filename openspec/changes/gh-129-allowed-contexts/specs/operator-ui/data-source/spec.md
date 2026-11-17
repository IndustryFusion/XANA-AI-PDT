## ADDED Requirements

### Requirement: Allowed contexts from the backend
The backend data source SHALL serve `listAllowedContexts`, `checkContext`, `allowContext` and `removeAllowedContext` from the backend, with their results in the documented shapes.

#### Scenario: Allowed contexts
- **WHEN** a screen lists, checks, allows or removes a context
- **THEN** it receives the list with each context's source, or the risks of the address
