# backend/explorer-api Specification

## Purpose
Backend routes for the Data explorer: query, browse, edit and import entities in the context broker that the backend is configured for.

## Requirements

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

#### Scenario: Every documented operator
- **WHEN** a query expression uses any operator the UI's data interface documents, including `~=`, `!~=`, `!attr` and ranges, on a real context broker
- **THEN** the matching entities are returned, whether or not the broker can evaluate that operator itself

#### Scenario: Search that stopped early
- **WHEN** the backend evaluates an expression itself, and there are more entities than it reads
- **THEN** the answer says how many were searched and how many there are, and the Data Explorer says that there may be more matches, also when nothing matched

#### Scenario: Pattern that takes long to evaluate
- **WHEN** an expression or an ID pattern holds a pattern with nested repetition, on a long value
- **THEN** it takes time linear in the value, and other requests are not held up. A pattern that can't run in linear time is refused as `invalid`.

#### Scenario: Patterns are the text as written
- **WHEN** a pattern for `~=` or `!~=` is unquoted, such as `serial~=20` or `serial!~=true`, or is a list such as `serial~="M","Z"`
- **THEN** the text as written is the pattern, a list matches when any of its patterns does, and the mock and backend sources agree

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
- **THEN** only it is removed, and the attribute and its other sub-attributes stay. With several datasets, it is removed from each dataset that has it.

#### Scenario: Adding one attribute twice at the same time
- **WHEN** two requests to this backend add the same new attribute at the same time
- **THEN** one succeeds and the other is refused as `conflict`

#### Scenario: Identifier that climbs
- **WHEN** an identifier is `.` or `..`
- **THEN** the request is refused, and nothing is sent to the context broker

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
- **WHEN** the URL has another scheme, or holds a user name or password, or can't be parsed
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

#### Scenario: More values than fit
- **WHEN** a range holds more values than the backend returns
- **THEN** the newest are returned, the answer says so, and the history says so

#### Scenario: Latest state
- **WHEN** the latest state of an entity's attributes is requested
- **THEN** each attribute is listed with whether it is deleted and when it was last observed, from its latest row of any instance, and with the same for each of its instances, keyed by dataset, `@none` for the default instance

#### Scenario: Latest state per instance
- **WHEN** an attribute's default instance is recorded as deleted after another instance was last written
- **THEN** the default instance is listed as deleted and the other instance as present, with its own last observation

#### Scenario: Many rows of one instance
- **WHEN** one instance of an attribute has more rows than the backend reads at once, and another instance or attribute follows it
- **THEN** the latest state of every instance and attribute is still listed

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

### Requirement: Paging
The entities query SHALL take an `offset` with the `limit`, and SHALL report the total number of matches when it is known.

#### Scenario: Paging to the end
- **WHEN** a query has more matches than the limit on a real context broker, and the caller asks with offsets 0, limit, twice the limit and so on
- **THEN** the pages together hold every match once, the total is reported, and the page after the last is empty

#### Scenario: Expression evaluated by the backend
- **WHEN** the backend evaluates the expression itself and an offset is given
- **THEN** the offset skips that many matches, and the answer says how far the search went if it stopped early

#### Scenario: Invalid offset
- **WHEN** the offset is negative or not a whole number
- **THEN** the request is refused as `invalid`, and nothing is sent to the context broker

### Requirement: Attributes to return
The entities query SHALL take a list of attribute names and return only those attributes, as the context broker does for the same NGSI-LD query with `attrs`.

#### Scenario: Selected attributes
- **WHEN** a query names attributes to return, on a real context broker
- **THEN** the entities and attributes returned are those the broker returns for the same query with `attrs`

#### Scenario: Short names with a context
- **WHEN** a context address is configured and an attribute is named by a term the context defines
- **THEN** the attribute whose full name matches the term is returned

#### Scenario: With an expression evaluated by the backend
- **WHEN** the backend evaluates the expression itself and attributes are selected
- **THEN** entities are matched on all their attributes, and only the selected attributes are returned

### Requirement: Has-attribute filter
The entities query SHALL take an attribute name and return only entities that have that attribute, each whole.

#### Scenario: Has attribute
- **WHEN** a query asks for entities that have an attribute, on a real context broker
- **THEN** the entities returned are those the broker returns for the same query with `attrs` set to that attribute, each with all its attributes

#### Scenario: With selected attributes
- **WHEN** a query asks for entities that have one attribute and selects others to return
- **THEN** the entities that have the first are returned with the selected attributes

#### Scenario: No entity has it
- **WHEN** no entity has the attribute
- **THEN** the answer is an empty list

### Requirement: Prefixes of the configured context
The backend SHALL offer the prefixes the configured JSON-LD context defines, each with its namespace, read from the configured context only. Without a configured context the list SHALL be empty. A context that can't be read SHALL give an empty list with the reason, not an error.

#### Scenario: Context with prefixes
- **WHEN** the configured context defines terms whose values are namespaces ending in `/` or `#`
- **THEN** the answer lists each such term as a prefix with its namespace, and no other term

#### Scenario: No context configured
- **WHEN** no context is configured
- **THEN** the answer is an empty list

#### Scenario: Context can't be read
- **WHEN** the configured context can't be fetched or is not valid JSON-LD
- **THEN** the answer is an empty list with a reason that names neither an address nor a token, and the other explorer routes keep working

#### Scenario: Caller names a context
- **WHEN** a caller adds a context address to the request
- **THEN** only the configured context is read

#### Scenario: Read once
- **WHEN** prefixes are asked for repeatedly
- **THEN** the context is fetched again at most once per ten minutes

### Requirement: Sub-attributes at any depth
The backend SHALL change, add and delete a sub-attribute at any depth, named by its path of attribute names below the entity. Whatever the operator did not change SHALL stay, at every level.

#### Scenario: Change a value at depth
- **WHEN** a sub-attribute of a sub-attribute gets a new value
- **THEN** only that value changes, and the attribute, its other sub-attributes and their sub-attributes stay

#### Scenario: Add at depth
- **WHEN** a sub-attribute is added to a sub-attribute
- **THEN** it is added there, and an existing sub-attribute of that name is refused as `conflict` with nothing changed

#### Scenario: Add to the attribute itself
- **WHEN** a sub-attribute is added to an attribute, named by the attribute and no path, whatever the attribute's kind, a relationship included
- **THEN** it is stored under the attribute as a sub-attribute with its own type and value, the attribute stays one attribute with its value or target, unit and other sub-attributes, and this holds on a broker whose merge stores its own result object; an existing sub-attribute of that name is refused as `conflict` with nothing changed

#### Scenario: Update that brings a new sub-attribute
- **WHEN** an update of an attribute names a sub-attribute the attribute doesn't have yet, with or without a new value
- **THEN** the sub-attribute is stored under the attribute with its own type and value, the value changes if the update gives one, and everything else of the attribute stays, on a broker whose merge stores its own result object too; a new sub-attribute without a type is refused as `invalid` with nothing changed

#### Scenario: Live updates after a write of a whole attribute
- **WHEN** an attribute is written back whole, to add or change a sub-attribute
- **THEN** the backend expects the broker's notification of that change, as for any other edit

#### Scenario: Delete at depth
- **WHEN** a sub-attribute of a sub-attribute is deleted
- **THEN** only it is removed, and with several datasets it is removed from each dataset that has it

#### Scenario: Path that doesn't exist
- **WHEN** a path names a level that doesn't exist
- **THEN** the request is refused as `not_found`, naming the first missing level, and nothing is changed

### Requirement: History of sub-attributes
The backend SHALL read a sub-attribute's values over a time range from the time-series store, named by its path of attribute names below the entity, in the same way as an attribute's.

#### Scenario: Sub-attribute values
- **WHEN** the history of a sub-attribute is requested by its path
- **THEN** only the values recorded for that sub-attribute under that parent are returned, oldest first

#### Scenario: Same name under another parent
- **WHEN** two attributes of an entity each have a sub-attribute of the same name
- **THEN** the history of one holds none of the other's values

#### Scenario: Top-level attribute unchanged
- **WHEN** the history of an attribute is requested without a path
- **THEN** the answer is the same as before this change, and holds no sub-attribute values

### Requirement: Declared values
The backend SHALL read a property value returned as a value object -- `@value` with its datatype as `type` or `@type` -- as that `@value`, and a number written as a string inside a value object of a numeric datatype as that number. Query conditions it evaluates itself SHALL compare against that value. It SHALL NOT depend on which form the broker returns for an attribute.

#### Scenario: Range on a declared double
- **WHEN** an entity's `temperature` is `{"type": "http://www.w3.org/2001/XMLSchema#double", "@value": 42.5}` and the query has `temperature==40..50` or `temperature>40`, evaluated by the backend
- **THEN** the entity matches

#### Scenario: Declared number written as a string
- **WHEN** the `temperature` is `{"type": "http://www.w3.org/2001/XMLSchema#double", "@value": "42.5"}` and the query has `temperature>40`, evaluated by the backend
- **THEN** the entity matches

#### Scenario: Plain values unchanged
- **WHEN** the `temperature` is the plain number `42.5`
- **THEN** the query behaves as before

### Requirement: Edits of declared values
A declared number SHALL count as a number when an edit is checked, and an edit of a declared value SHALL send the new value declared with the stored datatype. An edit with `exact` SHALL send the value in the form given, plain or declared, without keeping the stored datatype, and SHALL write the attribute whole.

#### Scenario: Text for a declared number
- **WHEN** the operator sets a `temperature` stored as a declared double to `hot`
- **THEN** the change is refused as not a number, and the broker is not called

#### Scenario: A number for a declared number
- **WHEN** the operator sets that `temperature` to `80`
- **THEN** the backend sends `{"@value": 80, "@type": "http://www.w3.org/2001/XMLSchema#double"}`, and reading the entity back gives 80

#### Scenario: A plain number edited
- **WHEN** the operator edits a `temperature` stored as the plain number `42.5`
- **THEN** the edit behaves as before

#### Scenario: Exact plain value
- **WHEN** a `temperature` stored as a declared double is set to the string `"2.7"` with `exact`
- **THEN** the backend writes the attribute whole with the plain string, its unit and sub-attributes kept, and reading it back gives `"2.7"` without a datatype

#### Scenario: Exact declared value
- **WHEN** a plain value is set to `{"@value": 80, "@type": "http://www.w3.org/2001/XMLSchema#double"}` with `exact`
- **THEN** the backend writes that value as given

#### Scenario: Exact value of an instance or at a path
- **WHEN** an instance with a dataset, or a sub-attribute at a path, is set with `exact`
- **THEN** the value is written as given, and the stored datatype is not kept

### Requirement: Instances of an attribute
The backend SHALL change one instance of an attribute with datasets by writing the attribute whole with every instance, the changed one replaced. With `dataset_id` and no path, a delete SHALL remove that instance alone, `@none` the default one, and the attribute with its last instance; at a path, `@none` SHALL name the default instance too. Adding SHALL accept an attribute's instances as a list.

#### Scenario: One instance changed
- **WHEN** the instance of one dataset gets a new value
- **THEN** the backend writes the attribute with every instance, that one changed, and the others stay as they were

#### Scenario: One instance deleted
- **WHEN** a delete names an attribute and the dataset of one of its instances
- **THEN** only that instance is removed, and the others stay

#### Scenario: The default instance deleted
- **WHEN** a delete names an attribute and the dataset `@none`
- **THEN** the default instance is removed, and the instances with a dataset stay

#### Scenario: A sub-attribute of the default instance
- **WHEN** a delete names a sub-attribute of an attribute with several instances and the dataset `@none`
- **THEN** it is removed from the default instance only, and the other instances keep theirs

#### Scenario: The last instance
- **WHEN** the only remaining instance is deleted
- **THEN** the attribute is removed

#### Scenario: No such instance
- **WHEN** a change or delete names a dataset the attribute has no instance of
- **THEN** the request is refused as `not_found`, and nothing is changed

#### Scenario: Instances added as a list
- **WHEN** an attribute is added as a list of instances, each with a type
- **THEN** it is stored with those instances, and a list with an instance without a type is refused as `invalid`

### Requirement: Writes the operator insists on
An update with `force` SHALL skip the backend's value checks, so that text for a number or an empty value is written. Without `force`, the checks SHALL apply as before.

#### Scenario: Forced text for a number
- **WHEN** text is given for a numeric value with `force`
- **THEN** it is written

#### Scenario: Forced value at a path
- **WHEN** a sub-attribute at a path of an instance gets a value the checks refuse, with `force`
- **THEN** it is written

#### Scenario: Not forced
- **WHEN** the same change is sent without `force`
- **THEN** it is refused as `invalid`, with the reason, and nothing is changed

### Requirement: Clearing a unit
An update that gives `unitCode` as `null` SHALL remove the unit from the attribute, the instance named by its dataset, or the sub-attribute at the path, and SHALL keep the value, the other instances and the sub-attributes. The attribute SHALL be written whole for it, as the broker's merge can't take a member away.

#### Scenario: Unit set
- **WHEN** an update gives an attribute `unitCode: "KEL"`
- **THEN** the attribute has that unit, and its value and sub-attributes stay

#### Scenario: Unit cleared
- **WHEN** an update gives an attribute `unitCode: null`
- **THEN** the attribute has no unit, its value and sub-attributes stay, and it is written whole

#### Scenario: Unit of one instance
- **WHEN** an update gives one instance of an attribute with datasets `unitCode: null`
- **THEN** only that instance loses its unit

#### Scenario: Unit at a path
- **WHEN** an update at a path gives a sub-attribute `unitCode: null`
- **THEN** only that sub-attribute loses its unit

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

### Requirement: Many entities at once
The backend SHALL give the entities of a list of IDs, and the latest states of their attributes, in one request each, up to 1,000 IDs of at most 2,048 characters each. It SHALL read the broker for up to 100 entities per query, and the time series for at most four entities at once. An ID without an entity SHALL be left out of the answer.

#### Scenario: Many entities
- **WHEN** 250 existing entities and one ID without an entity are asked for in one request
- **THEN** the 250 entities are returned by ID, the missing one is left out, and the broker was asked three times

#### Scenario: An ID the broker's list can't hold
- **WHEN** an ID contains a comma
- **THEN** that entity is read on its own and returned with the others

#### Scenario: An ID the broker refuses
- **WHEN** the broker refuses a list of IDs because of one of them
- **THEN** the other entities of the list are returned, and the refused ID is left out

#### Scenario: Latest states that can't be read
- **WHEN** the latest states of one of the entities asked for can't be read because the time series doesn't know or refuses that entity
- **THEN** that entity is left out, and the others' states are returned

#### Scenario: Time series failing
- **WHEN** the time series fails or can't be reached while the latest states of many entities are read
- **THEN** the request fails as a read of one entity's states does, and the reads still running stop

#### Scenario: Too many IDs
- **WHEN** more than 1,000 IDs are asked for in one request
- **THEN** the request is refused as invalid

#### Scenario: An ID too long
- **WHEN** an ID longer than 2,048 characters is among the IDs asked for
- **THEN** the request is refused as invalid, and nothing is sent to the broker or the time series

#### Scenario: Latest states of many entities
- **WHEN** the latest attribute states of many entities are asked for in one request
- **THEN** each entity's states are returned by ID, as for one entity, and no more than four entities' rows are read from the time series at once

### Requirement: Entities read by a list of IDs
Every read of entities by a list of IDs (the endpoints for many entities, the has-attribute filter's second read, the read before an import) SHALL query the broker for up to 100 IDs, read an ID with a comma and the IDs of a list too long for its address on their own, and without further parameters also those of a list it refuses, leaving out what it can't read; a failing broker SHALL fail the read.

#### Scenario: An existing ID with a comma in an import
- **WHEN** an entity whose ID contains a comma is imported while it exists
- **THEN** it is reported as `updated`

#### Scenario: An import whose list the broker refuses
- **WHEN** the broker refuses the list of the imported IDs
- **THEN** each is read on its own, and the existing ones are reported as `updated`, the others as `created`

#### Scenario: An import the broker refuses to read
- **WHEN** the broker refuses the list of the imported IDs and the read of one of them on its own
- **THEN** the import is refused, and nothing is written, as an ID the broker refuses is not taken for an absent one

#### Scenario: The has-attribute filter with an ID with a comma
- **WHEN** an entity whose ID contains a comma has the attribute asked for
- **THEN** it is returned whole, as the others

#### Scenario: The has-attribute filter with a list the broker refuses
- **WHEN** the broker refuses the list of the IDs found as invalid
- **THEN** the request is refused as invalid, as before, since the refusal can't be told from one of its parameters

#### Scenario: The has-attribute filter with a list too long
- **WHEN** the list of the IDs found is too long for the broker's address
- **THEN** each is read on its own, and the entities are returned whole

#### Scenario: Parameters the broker refuses
- **WHEN** the has-attribute filter asks for attributes the broker refuses, also for an ID with a comma read on its own
- **THEN** the request is refused as invalid, as before, and not answered as an empty list

#### Scenario: A single read failing
- **WHEN** the broker fails a read of one of the IDs read on their own, or answers it with no entity
- **THEN** the read fails, as a read of that entity alone does
