## ADDED Requirements

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
