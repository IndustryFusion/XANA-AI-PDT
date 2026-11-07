# Spec Delta

## MODIFIED Requirements

### Requirement: Attribute history
For attributes with recorded history the UI SHALL show the values over a selectable time range as a chart for numeric values and as a table for all values. An attribute whose latest recorded state is deleted SHALL say so.

#### Scenario: Numeric history
- **WHEN** the operator opens the history of a numeric attribute and picks a time range
- **THEN** a chart and a table of the values in that range are shown, with the unit

#### Scenario: Empty range
- **WHEN** no value was recorded in the selected range
- **THEN** the history says that there is no data in this time range

#### Scenario: Chart alternative
- **WHEN** the chart is shown
- **THEN** the same values are available in the table, so the information does not depend on seeing the chart

#### Scenario: Deleted attribute
- **WHEN** the operator opens the history of an attribute whose latest recorded state is deleted
- **THEN** the history says when it was deleted, and still shows its earlier values

#### Scenario: Attribute without an observation time
- **WHEN** the store holds rows for an attribute that states no observation time
- **THEN** its history can be opened

#### Scenario: History service unavailable
- **WHEN** the history cannot be read
- **THEN** the history says so with the reason, and the rest of the explorer keeps working
