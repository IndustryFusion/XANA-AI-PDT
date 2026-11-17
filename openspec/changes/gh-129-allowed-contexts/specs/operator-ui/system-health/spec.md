## ADDED Requirements

### Requirement: Allowed contexts
The System area SHALL list the contexts an imported entity may name, each with its source (NGSI-LD core, built in, deployment, added here), and SHALL let the operator add a context and remove one added here, after confirming. Before a context is added, it SHALL say that the broker fetches it from inside the platform and that its owner decides what names mean, and SHALL name the risks the backend reports for that address.

#### Scenario: The list
- **WHEN** the operator opens the System area
- **THEN** the allowed contexts are listed with their source, and only those added here offer *Remove…*

#### Scenario: Adding warns first
- **WHEN** the operator enters `http://contexts.example.net/c.jsonld` and chooses *Allow…*
- **THEN** a dialog states what allowing a context means and that this one is plain http, and offers *Allow anyway*; confirming lists it as added here

#### Scenario: No further risk
- **WHEN** the address has no risk beyond its owner
- **THEN** the dialog states what allowing a context means, and offers *Allow*

#### Scenario: No URL
- **WHEN** the operator chooses *Allow…* without a URL
- **THEN** the field asks for the context's URL

#### Scenario: Removing
- **WHEN** the operator removes a context added here, and confirms
- **THEN** it is no longer listed, and the dialog has said that entities already in the broker stay

#### Scenario: Not editable
- **WHEN** the backend can't add contexts
- **THEN** the list is shown without a way to add, and says why
