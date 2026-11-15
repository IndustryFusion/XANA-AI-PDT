## MODIFIED Requirements

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
