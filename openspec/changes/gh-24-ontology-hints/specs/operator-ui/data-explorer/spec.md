# Spec Delta

## ADDED Requirements

### Requirement: Allowed ranges while editing
The value editor SHALL show the allowed range of a value, where the data model gives one, as well as its suggested values. It SHALL work the same when there are no hints.

#### Scenario: Range shown
- **WHEN** the operator edits a value with an allowed range
- **THEN** the range is shown next to the input, saying whether each limit is included

#### Scenario: No hints
- **WHEN** no hints exist
- **THEN** the editor works as usual, and no error is shown

#### Scenario: Hints can't be read
- **WHEN** hints can't be read, for example for a missing role or a wrong graph base
- **THEN** the editor works as usual, and says why there are no suggestions
