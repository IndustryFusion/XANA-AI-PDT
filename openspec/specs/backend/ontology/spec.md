# backend/ontology Specification

## Purpose
Reads value hints and other ontology facts from the triple store for the agent and the UI, with query input that cannot change a query.

## Requirements

### Requirement: Value hints
`/api/shacl/hints` SHALL give the allowed values and ranges of an entity type's attribute from the configured Fuseki. When there are none, it SHALL answer `hint_type: none`.

#### Scenario: Allowed values
- **WHEN** a shape lists allowed values for the attribute
- **THEN** the answer has `hint_type: enum` and those values

#### Scenario: Values of a class
- **WHEN** a shape requires a class and the knowledge graph holds individuals of it
- **THEN** the answer has `hint_type: enum` and those individuals

#### Scenario: Range
- **WHEN** a shape gives minimum or maximum values
- **THEN** the answer has `hint_type: range`, those limits, and whether each is exclusive

#### Scenario: Shape on a parent class
- **WHEN** the shape targets a parent class of the entity type in the knowledge graph
- **THEN** its hints apply

#### Scenario: Short names
- **WHEN** the entity type and attribute are short names, and the graph has IRIs ending in them
- **THEN** the same hints are found

#### Scenario: Nothing known
- **WHEN** no shape covers the attribute, or the dataset is empty
- **THEN** the answer has `hint_type: none`

#### Scenario: Fuseki unavailable
- **WHEN** Fuseki cannot be reached, or refuses or fails, or answers something other than a query result, such as a sign-in page or a redirect
- **THEN** the answer is still successful, with `hint_type: none` and a reason, without an address or token

#### Scenario: Wrong graph base
- **WHEN** the configured graph holds no shapes at all
- **THEN** the answer has `hint_type: none`, and a reason that says to check the graph base

### Requirement: Read functions for the agent
The backend SHALL offer three read functions for the conversation agent: a SPARQL query, SHACL shapes for an entity type, and knowledge for an entity type. Errors SHALL come back as data, so the caller can continue. No function SHALL write.

#### Scenario: Shapes and knowledge
- **WHEN** shapes or knowledge are requested for a loaded entity type
- **THEN** the triples of that type's shapes, or its classes and individuals, are returned

#### Scenario: Service failure
- **WHEN** Fuseki is unavailable, answers an error, or answers anything that isn't a query result
- **THEN** the function returns the error as data and raises nothing, and no such answer is returned as a result

#### Scenario: Update refused
- **WHEN** the query function is given an update
- **THEN** it returns an error as data, and nothing is sent

#### Scenario: Federated query refused
- **WHEN** the query function is given a query that calls another service, however it is written, including what a parser here reads differently from Fuseki
- **THEN** it returns an error as data, nothing is sent, and a real Fuseki calls nothing

#### Scenario: The word and escapes refused in the raw text
- **WHEN** a query's text holds the word `service` in any case and at any place, including a comment or a string, or a `\u` or `\U` escape, or an `&#` entity
- **THEN** it is refused before any parser sees it, and the message says that a query merely holding the word is refused too

#### Scenario: Size and complexity
- **WHEN** a query is longer than the limit, or too deeply nested to parse
- **THEN** it is refused, with a message saying which, and a query at the limit takes about 2 seconds to check, off the event loop

#### Scenario: Query that can't be parsed
- **WHEN** the query function is given what can't be parsed as a query
- **THEN** it returns an error as data, and nothing is sent

#### Scenario: Large result
- **WHEN** a query matches more rows than the limit
- **THEN** the result is cut at the limit, and says so

### Requirement: Query input cannot change a query
Entity types and attributes SHALL be escaped when placed in queries, so that no input can change a query's structure.

#### Scenario: Hostile entity type
- **WHEN** an entity type holds a closing bracket, quote, brace, comment, line break or a further query clause
- **THEN** the query that is sent has the same structure as for a harmless name, or none is sent, and no other data is returned

### Requirement: Configured graph base
The graph names SHALL come from configuration, because the platform derives them from its external Fuseki host, not its service address.

#### Scenario: Other graph base
- **WHEN** a graph base other than the default is configured, and the graphs are loaded under it
- **THEN** hints and read functions find them

#### Scenario: Default
- **WHEN** no graph base is configured
- **THEN** it is the Fuseki address followed by the dataset

#### Scenario: Unsafe base
- **WHEN** the configured base can't be placed safely in a query
- **THEN** the backend refuses to start, with a message naming the variable

### Requirement: Units of an attribute
`/api/shacl/hints` SHALL also answer `units`: the unit codes a shape allows for the attribute's instances with `sh:in` on `ngsi-ld:unitCode`, for the same target classes as its values, sorted and without duplicates. Without such a rule, or when it can't be read, `units` SHALL be empty, and the rest of the answer SHALL be as before.

#### Scenario: Allowed units
- **WHEN** a shape allows `CEL` and `KEL` for the attribute's unit
- **THEN** the answer has `units: ["CEL", "KEL"]`

#### Scenario: Only units
- **WHEN** a shape names the attribute's units and nothing about its value
- **THEN** the answer has `hint_type: none`, those units, and no reason

#### Scenario: No unit rule
- **WHEN** no shape names units for the attribute
- **THEN** the answer has `units: []`

#### Scenario: Units can't be read
- **WHEN** the units query fails while the hints query answers
- **THEN** the answer has the hints as before and `units: []`

#### Scenario: Placed safely
- **WHEN** the entity type or attribute holds characters that could change a query
- **THEN** the units query is sent with them escaped, as the hints query is, or not sent

### Requirement: Units to offer
`/api/shacl/units` SHALL answer the units to offer for `unitCode`, each with its UN/CEFACT common code, symbol and name: the ones the knowledge describes as `qudt:Unit` with `qudt:uneceCommonCode`, else a built-in list of common codes, saying which (`source`). When Fuseki can't answer, it SHALL give the built-in list and the reason, without an address or token.

#### Scenario: Units in the knowledge
- **WHEN** the knowledge describes units with their common codes
- **THEN** the answer has `source: knowledge` and those units, sorted by code, each once

#### Scenario: No units in the knowledge
- **WHEN** the knowledge describes none
- **THEN** the answer has `source: built_in` and the built-in units, such as `CEL` with `°C` and `degree Celsius`, each code once

#### Scenario: Fuseki unavailable
- **WHEN** Fuseki can't be reached or fails
- **THEN** the answer is still successful, with `source: built_in`, the built-in units and the reason
