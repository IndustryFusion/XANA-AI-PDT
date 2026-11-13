## ADDED Requirements

### Requirement: Declared values in observations
The observe step SHALL read a property value that the context broker returns as a value object -- `@value` with its datatype as `type` or `@type` -- as that `@value`, and a number written as a string inside a value object of a numeric datatype as that number. A declared number SHALL count as a signal like a plain one, and the facts given to the model SHALL carry the plain value.

#### Scenario: Declared double as a signal
- **WHEN** the observed machine's `temperature` is `{"type": "http://www.w3.org/2001/XMLSchema#double", "@value": 42.5}` with unit `CEL`
- **THEN** the step lists `temperature` among the signals with value 42.5, unit `CEL` and its recent trend

#### Scenario: Declared number written as a string
- **WHEN** the `temperature` is `{"type": "http://www.w3.org/2001/XMLSchema#double", "@value": "42.5"}`
- **THEN** the step lists it as the signal value 42.5

#### Scenario: Facts carry the plain value
- **WHEN** the step describes the machine to the model
- **THEN** the `temperature` fact reads 42.5 with its unit, without the datatype

#### Scenario: Plain and declared values together
- **WHEN** one attribute is a plain number and another a declared double
- **THEN** both are listed as signals, each once
