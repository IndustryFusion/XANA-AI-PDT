# Spec Delta

## ADDED Requirements

### Requirement: Own configuration only
The explorer's routes SHALL reach only the services named in the backend's configuration. No route SHALL accept a server address, a credential or a request header to forward from its caller.

#### Scenario: Caller names a server
- **WHEN** a caller adds an address parameter to a request
- **THEN** the request still goes only to the configured service

#### Scenario: Identifier in a path
- **WHEN** an entity or attribute identifier holds path separators or dots
- **THEN** the request reaches the configured service with the identifier encoded, and it cannot address another path

### Requirement: Query and browse
The backend SHALL offer entities by type, ID, ID pattern, query expression and limit, one entity by ID, the list of types, the list of attributes, and statistics per type. Attribute names SHALL be returned as the broker gives them.

#### Scenario: Platform data with full names
- **WHEN** entities have attributes named by full IRIs and no context is configured
- **THEN** queries and answers use those IRIs unchanged

#### Scenario: Short names with a context
- **WHEN** a context address is configured and a query names an attribute by a term the context defines
- **THEN** entities whose full attribute name matches that term are returned

#### Scenario: Name the broker cannot match
- **WHEN** a query expression names an attribute by an IRI that the broker cannot evaluate
- **THEN** the backend still returns the entities that match

#### Scenario: Only an ID pattern
- **WHEN** the query has only an ID pattern
- **THEN** matching entities of any type are returned

#### Scenario: Statistics
- **WHEN** statistics are requested
- **THEN** the answer holds the number of entities, the number of types, and the count per type

#### Scenario: Invalid query
- **WHEN** a query expression has a syntax error, or the limit is outside 1 to 1000
- **THEN** the request is refused as `invalid`, with the reason and, for a syntax error, its position

### Requirement: Edit attributes and entities
The backend SHALL update and add attributes, and delete attributes, sub-attributes and entities in the context broker. Whatever the operator did not change SHALL stay.

#### Scenario: Change a value
- **WHEN** an attribute with a unit and sub-attributes gets a new value
- **THEN** the value and its observation time change, and the unit and sub-attributes stay

#### Scenario: Explicit observation time
- **WHEN** the change states an observation time
- **THEN** that time is kept

#### Scenario: Attribute with several datasets
- **WHEN** one dataset of an attribute changes
- **THEN** the other datasets stay unchanged

#### Scenario: Missing attribute
- **WHEN** an update or delete names an attribute or entity that does not exist
- **THEN** the request is refused as `not_found`

#### Scenario: Add an existing attribute
- **WHEN** adding attributes names one that already exists
- **THEN** the request is refused as `conflict`, and nothing is changed

#### Scenario: Wrong kind of value
- **WHEN** text is given for a numeric value
- **THEN** the request is refused as `invalid`, with the reason

#### Scenario: Delete a sub-attribute
- **WHEN** a sub-attribute is deleted
- **THEN** only it is removed, and the attribute and its other sub-attributes stay

### Requirement: Import
The backend SHALL create or merge a list of entities and report the result per entity. When only some succeed, it SHALL answer HTTP 207.

#### Scenario: New and existing entities
- **WHEN** a list holds a new entity and an existing one
- **THEN** the first is reported as `created` and the second as `updated`, with its other attributes kept

#### Scenario: Partial failure
- **WHEN** one entity of a list is rejected
- **THEN** the answer is HTTP 207, that entity is `failed` with the reason, and the others are imported

#### Scenario: Entities with and without a context
- **WHEN** a list mixes entities with and without their own context
- **THEN** both kinds are imported

### Requirement: Import from a URL
The backend SHALL fetch an import document from a public http or https URL, and SHALL refuse internal addresses. A refusal SHALL NOT reveal what the address resolved to.

#### Scenario: Internal address
- **WHEN** the URL's host is, or resolves to, a loopback, private, link-local, reserved or multicast address, in any notation, including IPv4 inside IPv6
- **THEN** the request is refused as `invalid`, and no connection is made

#### Scenario: Redirect to an internal address
- **WHEN** a public URL redirects to an internal address
- **THEN** the request is refused, and no connection is made to that address

#### Scenario: Changing DNS answer
- **WHEN** a host's name resolves to a public address when checked and an internal one later
- **THEN** the connection goes only to the checked address

#### Scenario: Other schemes and credentials
- **WHEN** the URL has another scheme, or holds a user name or password
- **THEN** the request is refused as `invalid`

#### Scenario: Too large or not JSON
- **WHEN** the document exceeds the size limit or is not JSON
- **THEN** the request is refused with a clear message, and the fetch stops

### Requirement: Delete by type
The backend SHALL delete all entities of the given types and report the count per type.

#### Scenario: Several types
- **WHEN** two types are deleted
- **THEN** all their entities are gone, including more than one page of them, and the counts are reported

#### Scenario: Failure part way
- **WHEN** the broker fails part way
- **THEN** the message says how many were deleted before it failed

### Requirement: History from the time-series store
The backend SHALL read an attribute's values over a time range, and the latest recorded state per attribute of an entity, from PostgREST, with the operator's token when there is one. Rows SHALL be read in the platform's table layout, including relationship and text values and rows where `deleted` is null.

#### Scenario: Numeric and text values
- **WHEN** an attribute's history holds numbers, or text or relationship targets
- **THEN** values come back oldest first, numbers as numbers and the others as text

#### Scenario: Null deleted flag
- **WHEN** a row's `deleted` value is null
- **THEN** the row is included

#### Scenario: Value in a filter
- **WHEN** an entity or attribute identifier holds characters with a meaning in a filter
- **THEN** it is matched literally, and it cannot widen or change the filter

#### Scenario: Latest state
- **WHEN** the latest state of an entity's attributes is requested
- **THEN** each attribute is listed with whether it is deleted and when it was last observed

### Requirement: Time-shift
The backend SHALL give the entity types and the entities as they were at a past moment, reconstructed from the `attributes` and `entities` tables.

#### Scenario: Entity created later or deleted earlier
- **WHEN** an entity was created after the moment, or deleted before it
- **THEN** it is not included. An entity deleted after the moment is included.

#### Scenario: Attribute values at the moment
- **WHEN** an attribute changed after the moment
- **THEN** the value from that moment is shown, with its kind, unit, sub-attributes and datasets

#### Scenario: Attribute deleted before the moment
- **WHEN** an attribute's latest row before the moment says it is deleted
- **THEN** the attribute and its sub-attributes are not included

#### Scenario: Query at the moment
- **WHEN** type, ID, ID pattern or query expression are given
- **THEN** they apply to the entities as they were at that moment

#### Scenario: Moment not in the past
- **WHEN** the moment is not in the past, or is not a timestamp
- **THEN** the request is refused as `invalid`

### Requirement: Failures behind the explorer
A service that cannot be reached or answers with a server error SHALL give `unavailable` with HTTP 502, naming the service. Messages SHALL NOT hold addresses, tokens or the service's raw answer, except the reason a broker gives for rejecting a request.

#### Scenario: Scorpio or PostgREST stopped
- **WHEN** either service is stopped
- **THEN** its routes answer HTTP 502 with a message that names it, and routes of the other keep working

#### Scenario: Token refused
- **WHEN** a service answers 401 or 403
- **THEN** the request is refused as `unauthorized`, saying which service refused

#### Scenario: Tokens stay out of logs
- **WHEN** requests with a token succeed or fail
- **THEN** the token is in no log line and no answer
