## ADDED Requirements

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
