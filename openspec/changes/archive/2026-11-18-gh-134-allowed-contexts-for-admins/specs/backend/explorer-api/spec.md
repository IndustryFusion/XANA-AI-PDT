## MODIFIED Requirements

### Requirement: Import
The backend SHALL create or replace a list of entities and report the result per entity. An entity that already exists SHALL be replaced, so attributes not in the imported entity are removed. When only some succeed, it SHALL answer HTTP 207.

#### Scenario: New and existing entities
- **WHEN** a list holds a new entity and an existing one
- **THEN** the first is reported as `created` and the second as `updated`, and the second holds exactly the attributes of the imported entity

#### Scenario: Attribute removed from the file
- **WHEN** an entity is imported, and imported again without one of its attributes, on a real context broker
- **THEN** the entity no longer has that attribute

#### Scenario: Partial failure
- **WHEN** one entity of a list is rejected
- **THEN** the answer is HTTP 207, that entity is `failed` with the reason, and the others are imported

#### Scenario: Entities with and without a context
- **WHEN** a list mixes entities without a context and entities with an allowed context
- **THEN** both kinds are imported

#### Scenario: Context that isn't allowed
- **WHEN** an entity names, at its top level, a remote context that isn't among the allowed contexts (*Allowed contexts*), whether it came from a file or a fetched document
- **THEN** that entity fails, the request does not reach the context broker, and the reason points to the System area's allowed contexts and says that an operator with `Factory-Admin` on the platform's client can allow it there; it names the context only when its address doesn't look internal

#### Scenario: A context that can never be allowed
- **WHEN** an entity names a context inside an attribute, or a context that an object context names or imports
- **THEN** that entity fails, the request does not reach the context broker, and the reason says that such a context can't be allowed, without pointing to the System area

#### Scenario: An external context named
- **WHEN** the refused context is `https://example.net/other.jsonld`
- **THEN** the reason names it

#### Scenario: An internal-looking context not named
- **WHEN** the refused context's host is an IP address that isn't public, a name without a dot, or a name ending in `.local`, `.internal`, `.svc` or `localhost`, with or without the root's trailing dot, such as `http://169.254.169.254/latest/meta-data`, `http://keycloak:8080/realms/iff` or `http://10.0.0.5./c`
- **THEN** the reason doesn't hold the address

#### Scenario: Internal addresses in a broker's reason
- **WHEN** the broker's reason for rejecting an entity holds an address
- **THEN** the address is left out of what the caller gets, with or without a scheme, such as `scorpio.svc.cluster.local:9090 [/10.0.0.5]`

#### Scenario: A document that can't be carried
- **WHEN** a document is nested too deeply, or holds a lone surrogate
- **THEN** the request is refused as `invalid`, without a server error

### Requirement: Allowed contexts
The contexts an imported entity may name SHALL be the ETSI core context, a built-in list (the IFF contexts and well-known vocabularies served by their own host), the deployment's (`NGSI_CONTEXT_URL`, `NGSI_ALLOWED_CONTEXTS`) and those added through `/api/ngsi/contexts`, kept in the memory database. An entry ending in `/` SHALL allow every context below it. `GET /api/ngsi/contexts` SHALL list them with their source and label, and say whether the operator may change the list.

#### Scenario: Built in
- **WHEN** an entity names `https://industryfusion.github.io/contexts/staging/opcua/v0.2/context.jsonld`, and nothing is configured
- **THEN** it is imported

#### Scenario: Well-known contexts built in
- **WHEN** an entity names `https://schema.org/`, `https://smartdatamodels.org/context.jsonld`, `https://fiware.github.io/data-models/context.jsonld`, `https://www.w3.org/ns/odrl.jsonld`, `https://www.w3.org/2018/credentials/v1` or `https://ref.gs1.org/voc/data/gs1Voc.jsonld`, and nothing is configured
- **THEN** its context is allowed

#### Scenario: Redirect services aren't built in
- **WHEN** an entity names `https://w3id.org/security/v2` or a context on `purl.org`, and nothing is configured
- **THEN** it is refused

#### Scenario: Others' content isn't built in
- **WHEN** an entity names a file below `https://raw.githubusercontent.com/smart-data-models/` other than `https://raw.githubusercontent.com/smart-data-models/data-models/master/context.jsonld`, such as one at a fork's commit or a pull request's head, and nothing is configured
- **THEN** it is refused

#### Scenario: Below an entry only
- **WHEN** the built-in entry is `https://industryfusion.github.io/contexts/`, and an entity names `https://industryfusion.github.io.evil.example/contexts/c`, or `https://industryfusion.github.io/contexts/../other/c`, with the `..` plain or percent-encoded
- **THEN** it is refused

#### Scenario: Listed with their source
- **WHEN** the list is asked for
- **THEN** each context is given with its source, `core`, `built_in`, `deployment` or `added`, its label for the core and built-in ones (such as `schema.org`), whether it can be removed, whether contexts can be added here at all, whether the signed-in operator may change the list, and which role may

#### Scenario: Another backend's change
- **WHEN** a context was added through another backend of the same deployment
- **THEN** it is allowed here within 30 seconds

#### Scenario: A change while the list is read
- **WHEN** a context is removed here while the list is being read
- **THEN** it is not allowed once the removal has answered

#### Scenario: The store can't be read
- **WHEN** the memory database can't be read
- **THEN** the other contexts still apply, those read last stay in force, and the list says that the added ones can't be read; once it can be read again, the list no longer says so

### Requirement: Allowing a context
`POST /api/ngsi/contexts` SHALL add a context, with the signed-in user who added it, and `DELETE` SHALL remove one that was added, only for an operator whose token carries `Factory-Admin` on the platform's client; anyone else SHALL be refused as `unauthorized` (HTTP 403), with the role named. Only a plain http or https URL SHALL be taken. `GET /api/ngsi/contexts/risks` SHALL say, to such an operator only, what allowing it risks beyond trusting its owner, resolving the host only.

#### Scenario: Added and removed
- **WHEN** an operator with `Factory-Admin` adds `https://example.org/c.jsonld`, then removes it
- **THEN** it is allowed, listed as `added`, then no longer allowed

#### Scenario: Without the role
- **WHEN** an operator without `Factory-Admin` on the platform's client, such as one with `Factory-Reader` only, adds or removes a context, or asks for an address's risks, through the UI or the API
- **THEN** it is refused as `unauthorized` with HTTP 403, naming `Factory-Admin` and the client, nothing is stored or removed, and the list still answers, saying that the operator may not change it

#### Scenario: Without sign-in
- **WHEN** nobody is signed in, or the backend has no sign-in
- **THEN** the list says that it may not be changed, and adding, removing and the risks check are refused as `unauthorized`; once an operator with `Factory-Admin` signs in, the list says that it may be changed, and they are taken

#### Scenario: Not a plain URL
- **WHEN** an operator with `Factory-Admin` gives a URL that isn't http or https, has no host, has a port that isn't a number from 0 to 65535, holds a user name, a password or spaces, or is longer than 2000 characters
- **THEN** it is refused as `invalid`, and nothing is stored

#### Scenario: Allowed already
- **WHEN** an operator with `Factory-Admin` adds a URL that is allowed already, such as one below the built-in entry
- **THEN** it is refused as `invalid`

#### Scenario: Not added here
- **WHEN** a client removes a context that wasn't added here
- **THEN** it is refused as `not_found`

#### Scenario: Risks
- **WHEN** the risks of `http://example.org/c.jsonld`, of a URL whose host resolves to `10.0.0.5`, and of one whose host can't be resolved are asked for
- **THEN** the answers name plain http, an address inside the network, and an unresolvable host

#### Scenario: Without a memory database
- **WHEN** the backend has no memory database
- **THEN** the list says that contexts can't be added, and adding is refused as `unavailable`
