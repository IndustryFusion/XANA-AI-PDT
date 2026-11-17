## MODIFIED Requirements

### Requirement: Allowed contexts from the backend
The backend data source SHALL serve `listAllowedContexts`, `checkContext`, `allowContext` and `removeAllowedContext` from the backend, with their results in the documented shapes.

#### Scenario: Allowed contexts
- **WHEN** a screen lists, checks, allows or removes a context
- **THEN** it receives the list with each context's source and label, whether the operator may change it and which role may, or the risks of the address

#### Scenario: Refused for the role
- **WHEN** the backend refuses a change with HTTP 403
- **THEN** the screen receives it as `unauthorized`, with the backend's message

## ADDED Requirements

### Requirement: Allowed contexts on the mock source
In development mode, the mock data source SHALL offer a control for an operator who may not change the allowed contexts. With it, with sign-in off, or while signed out, the list SHALL say so, and checking, adding and removing a context SHALL be refused as `unauthorized`, as the backend does.

#### Scenario: An operator without the role
- **WHEN** the control is set, or sign-in is off, and a screen lists, checks, adds or removes a context
- **THEN** the list says that it may not be changed and which role may, and the other operations are refused as `unauthorized`
