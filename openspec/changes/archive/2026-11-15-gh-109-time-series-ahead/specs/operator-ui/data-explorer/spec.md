## ADDED Requirements

### Requirement: Values behind the time series
Alerts are checked against the latest values the time-series store records. The Data explorer SHALL mark a top-level attribute value whose instance has a later observation in the time series than the one shown, or is recorded there as deleted: with a small attention mark beside the value whose tooltip says what is wrong, and with the value, its unit and its observation time shown faint. Each instance SHALL be compared with the latest state of its own dataset only.

#### Scenario: Newer value in the time series
- **WHEN** the time series holds a later observation of an attribute's instance than the one shown
- **THEN** a mark beside the value says that the time series holds a more recent value, that alerts check the latest value, and to see the history, and the value is shown faint

#### Scenario: Deleted in the time series
- **WHEN** the time series records an attribute's instance as deleted while the broker still holds it
- **THEN** a mark beside the value says that the time series records it as deleted, and the value is shown faint

#### Scenario: Another instance deleted
- **WHEN** the default instance of an attribute is recorded as deleted, and the instance shown is another one that is still present
- **THEN** the instance shown is not marked

#### Scenario: A value as recent as the time series
- **WHEN** a marked value is replaced by a live update or a reload with a value observed as late as the time series' latest, or later
- **THEN** the mark is gone and the value is no longer faint

#### Scenario: Instance not in the time series
- **WHEN** the time series holds no row for the instance shown
- **THEN** the value is not marked

#### Scenario: Same time in another notation
- **WHEN** the time series and the broker give the same observation time in different notations
- **THEN** the value is not marked

#### Scenario: Reachable by keyboard
- **WHEN** the operator moves through the explorer with the keyboard or a screen reader
- **THEN** the mark can be focused, and its text is read out

#### Scenario: After a save
- **WHEN** the operator saves a value that was marked
- **THEN** the time-series state is read again shortly after, and the mark is gone once the time series holds the saved value
