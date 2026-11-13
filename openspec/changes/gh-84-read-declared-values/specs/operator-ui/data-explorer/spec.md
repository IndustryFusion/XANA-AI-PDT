## ADDED Requirements

### Requirement: Declared values
The Data explorer SHALL show a property value that arrives as a value object -- `@value` with its datatype as `type` or `@type` -- as that `@value`, and a number written as a string inside a value object of a numeric datatype as that number, whether it arrives with the entity or as a live update. Such a value SHALL be editable in place like a plain one, an edit SHALL keep its datatype, and a live update SHALL highlight it only when its value changed.

#### Scenario: Declared double shown
- **WHEN** an entity's `temperature` arrives as `{"type": "http://www.w3.org/2001/XMLSchema#double", "@value": 42.5}`
- **THEN** the attribute shows `42.5`

#### Scenario: Declared double edited in place
- **WHEN** the operator edits that `temperature` in place and enters `80`
- **THEN** the value is saved, reads back as `80`, and is still a declared double in the broker

#### Scenario: Same value, other form
- **WHEN** a live update brings `{"type": "http://www.w3.org/2001/XMLSchema#double", "@value": "42.5"}` for a `temperature` shown as `42.5`
- **THEN** it is not highlighted as changed

#### Scenario: Changed declared value
- **WHEN** a live update brings `{"type": "http://www.w3.org/2001/XMLSchema#double", "@value": 43}`
- **THEN** the attribute shows `43` and is highlighted as changed
