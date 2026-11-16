## ADDED Requirements

### Requirement: Unit of a value
The editor of a property's value SHALL offer its unit beside the value: the units the data model allows, else the units to offer, each shown as code, symbol and name, with the stored unit, *No unit* and *Other code…*. A code the data model doesn't allow, or unknown where it allows none, SHALL be refused with the reason and can be saved anyway. Changing the unit SHALL keep the value.

#### Scenario: The data model's units
- **WHEN** the operator edits a value whose attribute the data model allows `CEL` and `KEL` for
- **THEN** the unit choice offers *No unit*, `CEL · °C · degree Celsius`, `KEL · K · kelvin`, the stored unit and *Other code…*, with the stored unit chosen

#### Scenario: The units to offer
- **WHEN** the data model allows no particular units for the attribute
- **THEN** the unit choice offers the units to offer

#### Scenario: Unit changed
- **WHEN** the operator chooses `KEL` and saves
- **THEN** the editor says that the unit changes to `KEL`, the attribute has that unit, and its value and dataset stay

#### Scenario: Unit removed
- **WHEN** the operator chooses *No unit* and saves
- **THEN** the editor says that the unit is removed, and the attribute has none

#### Scenario: A unit not allowed
- **WHEN** the operator enters `BAR` as another code where the data model allows `CEL` and `KEL`
- **THEN** it is refused, naming the allowed units, and *Save anyway* writes `BAR`

#### Scenario: An unknown code
- **WHEN** the operator enters `XYZ` where the data model allows no particular units
- **THEN** it is refused as no known UN/CEFACT unit code

#### Scenario: No code entered
- **WHEN** the operator chooses *Other code…* and enters nothing
- **THEN** the editor asks for the unit code
